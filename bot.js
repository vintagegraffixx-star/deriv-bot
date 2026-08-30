/**
 * ============================================================
 *  DERIV BOOM & CRASH EA BOT — OPTION B (SERVER / RAILWAY)
 *  Runs 24/7 on Railway.app — trades while your phone is off
 *  Includes live web dashboard at your Railway URL
 * ============================================================
 */

require('dotenv').config();
const WebSocket = require('ws');
const chalk     = require('chalk');
const express   = require('express');

// ─────────────────────────────────────────────────────────────
//  CONFIG — set these in Railway dashboard → Variables tab
//  (or in .env file for local testing)
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  DERIV_API_TOKEN : process.env.DERIV_API_TOKEN || 'PASTE_YOUR_TOKEN_HERE',
  DEMO_MODE       : process.env.DEMO_MODE !== 'false',
  INSTRUMENT      : process.env.INSTRUMENT      || 'BOOM500',
  BASE_STAKE      : parseFloat(process.env.BASE_STAKE     || '0.35'),
  MAX_DAILY_DD    : parseFloat(process.env.MAX_DAILY_DD   || '10'),
  DAILY_TARGET    : parseFloat(process.env.DAILY_TARGET   || '15'),
  MARTINGALE      : process.env.MARTINGALE !== 'false',
  MARTI_MULT      : parseFloat(process.env.MARTI_MULT     || '1.8'),
  MARTI_MAX_LEVEL : parseInt(process.env.MARTI_MAX_LEVEL  || '3'),
  PORT            : parseInt(process.env.PORT             || '3000'),
};

const SYMBOL_MAP = {
  BOOM500  : 'RDBULL',
  BOOM1000 : 'RDBEAR',
  CRASH500 : 'RDCRASH500',
  CRASH1000: 'RDCRASH1000',
};

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
const S = {
  ws:null, authorised:false,
  balance:0, startBalance:0, lowestBalance:Infinity,
  wins:0, losses:0, trades:0, consecutiveLoss:0,
  stopped:false, ticks:[], inTrade:false,
  activeContractId:null, reqId:1, pendingCbs:{},
  dailyPnl:0, sessionStart:new Date(), reconnects:0,
  recentLogs:[], recentTrades:[],
};

// ─────────────────────────────────────────────────────────────
//  LOGGING
// ─────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace('T',' ').slice(0,19);

function pushLog(type, msg) {
  S.recentLogs.unshift({ time: ts(), type, msg });
  if (S.recentLogs.length > 100) S.recentLogs.pop();
}

const log = {
  info  : (...a) => { const m=a.join(' '); console.log(chalk.cyan(`[${ts()}]`),m);         pushLog('info',m);  },
  trade : (...a) => { const m=a.join(' '); console.log(chalk.yellow(`[${ts()}]`),m);        pushLog('trade',m); },
  win   : (...a) => { const m=a.join(' '); console.log(chalk.green(`[${ts()}] ✓`),m);       pushLog('win',m);   },
  loss  : (...a) => { const m=a.join(' '); console.log(chalk.red(`[${ts()}] ✗`),m);         pushLog('loss',m);  },
  warn  : (...a) => { const m=a.join(' '); console.log(chalk.magenta(`[${ts()}] ⚠`),m);     pushLog('warn',m);  },
  stop  : (...a) => { const m=a.join(' '); console.log(chalk.bgRed.white(`[${ts()}] ⛔`),m);pushLog('stop',m);  },
};

// ─────────────────────────────────────────────────────────────
//  WEB DASHBOARD (required by Railway to keep service alive)
// ─────────────────────────────────────────────────────────────
const app = express();

app.get('/', (_req, res) => {
  const uptime  = Math.floor((Date.now() - S.sessionStart) / 1000);
  const uptimeStr = `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`;
  const pnlPct  = S.startBalance ? (((S.balance-S.startBalance)/S.startBalance)*100).toFixed(2) : '0.00';
  const dd      = drawdownPct().toFixed(2);
  const wr      = winRate();
  const pnlAbs  = (S.balance-S.startBalance).toFixed(2);

  const logHTML = S.recentLogs.slice(0,50).map(l => {
    const color = {win:'#22c55e',loss:'#ef4444',trade:'#f59e0b',stop:'#ef4444',warn:'#f59e0b',info:'#60a5fa'}[l.type]||'#94a3b8';
    return `<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid #1e2d45;font-size:11px">
      <span style="color:#4a6080;min-width:150px;flex-shrink:0">${l.time}</span>
      <span style="color:${color}">${l.msg.replace(/</g,'&lt;')}</span>
    </div>`;
  }).join('');

  const tradeHTML = S.recentTrades.slice(0,15).map((t,i) =>
    `<tr style="border-bottom:1px solid #1e2d45">
      <td style="padding:5px 8px;color:#4a6080">#${S.trades-i}</td>
      <td style="padding:5px 8px;color:#94a3b8;font-size:11px">${t.strategy}</td>
      <td style="padding:5px 8px"><span style="background:${t.dir==='up'?'#0d2d1a':'#2d0d0d'};color:${t.dir==='up'?'#22c55e':'#ef4444'};padding:2px 7px;border-radius:99px;font-size:10px">${t.dir==='up'?'▲ UP':'▼ DOWN'}</span></td>
      <td style="padding:5px 8px;color:#f59e0b">$${t.stake}</td>
      <td style="padding:5px 8px;color:${t.profit>=0?'#22c55e':'#ef4444'};font-weight:700">${t.profit>=0?'+':''}$${t.profit.toFixed(2)}</td>
    </tr>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Deriv EA Bot — Live Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080f1a;color:#e2e8f5;font-family:'Courier New',monospace;padding:20px;min-height:100vh}
h1{font-size:20px;color:#60a5fa;letter-spacing:3px;margin-bottom:4px}
.sub{font-size:11px;color:#4a6080;margin-bottom:20px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;margin-bottom:16px}
.dot{width:8px;height:8px;border-radius:50%;animation:p 1.2s infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:0.3}}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
.card{background:#0d1829;border:1px solid #1e2d45;border-radius:8px;padding:14px 16px}
.card-label{font-size:10px;color:#4a6080;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.card-val{font-size:24px;font-weight:700}
.section{background:#0d1829;border:1px solid #1e2d45;border-radius:8px;margin-bottom:14px;overflow:hidden}
.section-head{padding:10px 14px;border-bottom:1px solid #1e2d45;font-size:10px;color:#4a6080;text-transform:uppercase;letter-spacing:1px;display:flex;justify-content:space-between}
.section-body{padding:12px 14px}
.cfg-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #1e2d45}
.cfg-row:last-child{border:none}
.cfg-key{color:#4a6080}
table{width:100%;border-collapse:collapse;font-size:12px}
th{padding:6px 8px;text-align:left;font-size:10px;color:#4a6080;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #1e2d45}
.log-wrap{max-height:280px;overflow-y:auto;padding:4px 0}
footer{font-size:10px;color:#4a6080;text-align:center;margin-top:16px}
</style>
</head>
<body>
<h1>⚡ DERIV EA BOT</h1>
<p class="sub">Auto-refreshes every 10 seconds · ${ts()}</p>

<div class="pill" style="background:${S.stopped?'#2d0d0d':'#0d2d1a'};border:1px solid ${S.stopped?'#dc2626':'#16a34a'}">
  <span class="dot" style="background:${S.stopped?'#ef4444':'#22c55e'}"></span>
  <span style="color:${S.stopped?'#ef4444':'#22c55e'}">${S.stopped?'STOPPED':CONFIG.DEMO_MODE?'DEMO — RUNNING':'LIVE — RUNNING'}</span>
</div>
<span style="font-size:11px;color:#4a6080;margin-left:10px">Uptime: ${uptimeStr} · Reconnects: ${S.reconnects}</span>

<div class="grid" style="margin-top:14px">
  <div class="card"><div class="card-label">Balance</div><div class="card-val" style="color:#60a5fa">$${S.balance.toFixed(2)}</div></div>
  <div class="card"><div class="card-label">Daily P&L</div><div class="card-val" style="color:${parseFloat(pnlAbs)>=0?'#22c55e':'#ef4444'}">${parseFloat(pnlAbs)>=0?'+':''}$${Math.abs(parseFloat(pnlAbs)).toFixed(2)}</div></div>
  <div class="card"><div class="card-label">P&L %</div><div class="card-val" style="color:${parseFloat(pnlPct)>=0?'#22c55e':'#ef4444'}">${parseFloat(pnlPct)>=0?'+':''}${pnlPct}%</div></div>
  <div class="card"><div class="card-label">Drawdown</div><div class="card-val" style="color:${parseFloat(dd)>7?'#ef4444':parseFloat(dd)>4?'#f59e0b':'#22c55e'}">${dd}%</div></div>
  <div class="card"><div class="card-label">Win Rate</div><div class="card-val" style="color:${wr>=55?'#22c55e':wr>=45?'#f59e0b':'#ef4444'}">${wr}%</div></div>
  <div class="card"><div class="card-label">Trades</div><div class="card-val">${S.trades} <span style="font-size:14px;color:#4a6080">(${S.wins}W/${S.losses}L)</span></div></div>
</div>

<div class="section">
  <div class="section-head"><span>Bot config</span><span>${CONFIG.INSTRUMENT}</span></div>
  <div class="section-body">
    <div class="cfg-row"><span class="cfg-key">Mode</span><span style="color:${CONFIG.DEMO_MODE?'#f59e0b':'#ef4444'}">${CONFIG.DEMO_MODE?'🟡 DEMO — no real money':'🔴 LIVE — real money'}</span></div>
    <div class="cfg-row"><span class="cfg-key">Base stake</span><span>$${CONFIG.BASE_STAKE}</span></div>
    <div class="cfg-row"><span class="cfg-key">Max drawdown</span><span>${CONFIG.MAX_DAILY_DD}%</span></div>
    <div class="cfg-row"><span class="cfg-key">Daily target</span><span>+${CONFIG.DAILY_TARGET}%</span></div>
    <div class="cfg-row"><span class="cfg-key">Recovery</span><span>${CONFIG.MARTINGALE?'Martingale-lite '+CONFIG.MARTI_MULT+'x (max '+CONFIG.MARTI_MAX_LEVEL+' levels)':'Off'}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-head"><span>Recent trades</span><span>${S.trades} total</span></div>
  <table><thead><tr><th>#</th><th>Strategy</th><th>Direction</th><th>Stake</th><th>P&L</th></tr></thead>
  <tbody>${tradeHTML || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#4a6080">No trades yet</td></tr>'}</tbody></table>
</div>

<div class="section">
  <div class="section-head"><span>Activity log</span><span>${S.recentLogs.length} events</span></div>
  <div class="log-wrap">${logHTML || '<div style="padding:12px;color:#4a6080">No activity yet</div>'}</div>
</div>

<footer>Deriv EA Bot · Boom & Crash · Spike Reversal + EMA Pullback + Stoch RSI</footer>
</body>
</html>`);
});

// JSON endpoint for programmatic checks / monitoring
app.get('/api/status', (_req, res) => {
  res.json({
    running     : !S.stopped,
    demo        : CONFIG.DEMO_MODE,
    instrument  : CONFIG.INSTRUMENT,
    balance     : S.balance,
    startBalance: S.startBalance,
    pnlPct      : S.startBalance?(((S.balance-S.startBalance)/S.startBalance)*100).toFixed(2):0,
    drawdownPct : drawdownPct().toFixed(2),
    wins        : S.wins, losses: S.losses, trades: S.trades,
    winRate     : winRate(),
    uptime      : Math.floor((Date.now()-S.sessionStart)/1000),
    reconnects  : S.reconnects,
  });
});

app.listen(CONFIG.PORT, () => log.info(`Dashboard live → http://localhost:${CONFIG.PORT}`));

// ─────────────────────────────────────────────────────────────
//  WEBSOCKET
// ─────────────────────────────────────────────────────────────
function connect() {
  S.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
  S.ws.on('open',    ()    => { log.info('Connected to Deriv API'); authorize(); });
  S.ws.on('message', raw  => { try { handleMessage(JSON.parse(raw)); } catch(e){} });
  S.ws.on('close',   ()   => {
    if (!S.stopped) {
      S.reconnects++;
      const delay = Math.min(5000*S.reconnects, 30000);
      log.warn(`Disconnected. Reconnecting in ${delay/1000}s...`);
      setTimeout(connect, delay);
    }
  });
  S.ws.on('error', e => log.warn('WS error:', e.message));
}

function send(payload, cb) {
  const id = S.reqId++;
  payload.req_id = id;
  if (cb) S.pendingCbs[id] = cb;
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(payload));
  return id;
}

function handleMessage(msg) {
  if (msg.req_id && S.pendingCbs[msg.req_id]) {
    const cb = S.pendingCbs[msg.req_id]; delete S.pendingCbs[msg.req_id]; cb(msg); return;
  }
  if (msg.msg_type === 'tick')                   return onTick(msg.tick);
  if (msg.msg_type === 'proposal_open_contract') return onContractUpdate(msg.proposal_open_contract);
  if (msg.msg_type === 'balance')                return onBalance(msg.balance);
  if (msg.error) log.warn(`API [${msg.error.code}]: ${msg.error.message}`);
}

// ─────────────────────────────────────────────────────────────
//  AUTH & SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────
function authorize() {
  send({ authorize: CONFIG.DERIV_API_TOKEN }, msg => {
    if (msg.error) { log.stop('Auth failed:', msg.error.message, '— check DERIV_API_TOKEN in Railway Variables'); return; }
    S.authorised = true;
    S.balance = parseFloat(msg.authorize.balance);
    S.startBalance = S.balance;
    S.lowestBalance = S.balance;
    log.info(`Authorized: ${msg.authorize.email}`);
    log.info(`Balance: $${S.balance.toFixed(2)} | Mode: ${CONFIG.DEMO_MODE?'DEMO':'LIVE'} | ${CONFIG.INSTRUMENT}`);
    log.info(`Target: +${CONFIG.DAILY_TARGET}% | Max DD: ${CONFIG.MAX_DAILY_DD}% | Stake: $${CONFIG.BASE_STAKE}`);
    send({ balance: 1, subscribe: 1 });
    subscribeTicks();
    scheduleDailyReset();
  });
}

function subscribeTicks() {
  send({ ticks: SYMBOL_MAP[CONFIG.INSTRUMENT], subscribe: 1 }, () =>
    log.info(`Subscribed to ${CONFIG.INSTRUMENT} ticks. Bot scanning...`)
  );
}

function onBalance(data) {
  S.balance = parseFloat(data.balance);
  if (S.balance < S.lowestBalance) S.lowestBalance = S.balance;
}

// ─────────────────────────────────────────────────────────────
//  MIDNIGHT RESET
// ─────────────────────────────────────────────────────────────
function scheduleDailyReset() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1));
  setTimeout(() => {
    log.info('--- Midnight UTC reset: counters cleared ---');
    S.startBalance=S.balance; S.lowestBalance=S.balance;
    S.dailyPnl=0; S.wins=0; S.losses=0; S.trades=0;
    S.consecutiveLoss=0; S.stopped=false;
    scheduleDailyReset();
    if (!S.inTrade) subscribeTicks();
  }, next-now);
  log.info(`Next daily reset in ${Math.round((next-now)/3600000)}h`);
}

// ─────────────────────────────────────────────────────────────
//  TICK → SIGNAL → TRADE
// ─────────────────────────────────────────────────────────────
function onTick(tick) {
  if (!tick || S.stopped || S.inTrade) return;
  S.ticks.push(parseFloat(tick.quote));
  if (S.ticks.length > 200) S.ticks.shift();
  if (S.ticks.length < 30)  return;
  const signal = analyze(S.ticks);
  if (signal) placeTrade(signal);
}

function analyze(prices) {
  const n=prices.length, ar=avgDiff(prices.slice(-30));
  const sU=prices[n-1]-prices[n-2]>ar*3, sD=prices[n-2]-prices[n-1]>ar*3;
  const R=rsi(prices,14), E8=ema(prices,8), E21=ema(prices,21);
  const E200=prices.length>=200?ema(prices,200):null;
  const bb=bollinger(prices,20,2), abw=avgBW(prices,20,2,20);
  const sq=bb.bw<abw*0.85, SR=stochRSI(prices,14), MH=macdHisto(prices), p=prices[n-1];

  if((sU||sD)&&sq){
    if(sU&&R>65) return{dir:'down',strategy:'Spike Reversal'};
    if(sD&&R<35) return{dir:'up',  strategy:'Spike Reversal'};
  }
  if(E8&&E21){
    const tr=E8>E21?'up':'down', mc=E200?(p>E200?'up':'down'):tr;
    if(tr==='up'  &&p<=E8*1.001&&MH>0&&mc==='up')  return{dir:'up',  strategy:'EMA Pullback'};
    if(tr==='down'&&p>=E8*0.999&&MH<0&&mc==='down') return{dir:'down',strategy:'EMA Pullback'};
  }
  if(SR!==null){
    if(SR<15&&R<35) return{dir:'up',  strategy:'Stoch RSI'};
    if(SR>85&&R>65) return{dir:'down',strategy:'Stoch RSI'};
  }
  return null;
}

function getStake(){
  if(!CONFIG.MARTINGALE||S.consecutiveLoss<2) return CONFIG.BASE_STAKE;
  const lv=Math.min(S.consecutiveLoss-1,CONFIG.MARTI_MAX_LEVEL);
  return Math.min(CONFIG.BASE_STAKE*Math.pow(CONFIG.MARTI_MULT,lv),S.balance*0.05);
}

function placeTrade(signal) {
  const dd=drawdownPct(), pnlP=pnlPct();
  if(dd>=CONFIG.MAX_DAILY_DD)  { log.stop(`DD limit ${CONFIG.MAX_DAILY_DD}% hit — paused until midnight`); S.stopped=true; return; }
  if(pnlP>=CONFIG.DAILY_TARGET){ log.win( `Target +${CONFIG.DAILY_TARGET}% locked — paused until midnight`); S.stopped=true; return; }
  const stake=parseFloat(getStake().toFixed(2));
  if(stake<0.35){ log.warn('Stake below minimum. Skipping.'); return; }
  S.inTrade=true;
  log.trade(`Signal: ${signal.strategy} | ${signal.dir.toUpperCase()} | Stake: $${stake} | DD: ${dd.toFixed(1)}%`);
  if(CONFIG.DEMO_MODE){ simulateTrade(signal,stake); return; }
  send({buy:1,price:stake,parameters:{
    contract_type:signal.dir==='up'?'CALL':'PUT',
    symbol:SYMBOL_MAP[CONFIG.INSTRUMENT],
    duration:5,duration_unit:'t',basis:'stake',currency:'USD',
  }},msg=>{
    if(msg.error){ log.warn('Order failed:',msg.error.message); S.inTrade=false; return; }
    S.activeContractId=msg.buy.contract_id;
    log.trade(`Order placed | ID: ${msg.buy.contract_id}`);
    send({proposal_open_contract:1,contract_id:msg.buy.contract_id,subscribe:1});
  });
}

function onContractUpdate(c){
  if(!c||c.contract_id!==S.activeContractId||c.status==='open') return;
  recordResult(parseFloat(c.profit)>0,parseFloat(c.profit),parseFloat(c.balance_after),S.lastSignal);
}

function simulateTrade(signal,stake){
  const wP={'Spike Reversal':0.61,'EMA Pullback':0.57,'Stoch RSI':0.55}[signal.strategy]||0.57;
  const won=Math.random()<wP, profit=won?parseFloat((stake*(1.4+Math.random()*0.4)).toFixed(2)):-stake;
  setTimeout(()=>recordResult(won,profit,null,signal),900+Math.random()*1200);
}

function recordResult(won,profit,balAfter,signal){
  S.trades++;
  S.balance=balAfter??parseFloat((S.balance+profit).toFixed(2));
  S.dailyPnl+=profit;
  if(S.balance<S.lowestBalance) S.lowestBalance=S.balance;
  S.recentTrades.unshift({strategy:(signal||{}).strategy||'—',dir:(signal||{}).dir||'—',stake:parseFloat(getStake().toFixed(2)),profit});
  if(S.recentTrades.length>50) S.recentTrades.pop();
  if(won){ S.wins++; S.consecutiveLoss=0; log.win(`WIN +$${Math.abs(profit).toFixed(2)} | Bal: $${S.balance.toFixed(2)} | WR: ${winRate()}% | Trades: ${S.trades}`); }
  else   { S.losses++; S.consecutiveLoss++; log.loss(`LOSS -$${Math.abs(profit).toFixed(2)} | Bal: $${S.balance.toFixed(2)} | Streak: ${S.consecutiveLoss}`); }
  S.inTrade=false; S.activeContractId=null;
}

// ─────────────────────────────────────────────────────────────
//  INDICATORS
// ─────────────────────────────────────────────────────────────
function ema(p,n){if(p.length<n)return null;const k=2/(n+1);let e=p.slice(0,n).reduce((a,b)=>a+b,0)/n;for(let i=n;i<p.length;i++)e=p[i]*k+e*(1-k);return e;}
function rsi(p,n=14){if(p.length<n+1)return 50;const ch=p.slice(1).map((v,i)=>v-p[i]),rc=ch.slice(-n),g=rc.filter(c=>c>0).reduce((a,b)=>a+b,0)/n,l=rc.filter(c=>c<0).map(c=>Math.abs(c)).reduce((a,b)=>a+b,0)/n;if(l===0)return 100;return 100-(100/(1+g/l));}
function bollinger(p,n=20,m=2){if(p.length<n)return{bw:0};const sl=p.slice(-n),mn=sl.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(sl.reduce((a,b)=>a+(b-mn)**2,0)/n);return{bw:(2*m*sd)/mn};}
function avgBW(p,n=20,m=2,lb=20){if(p.length<n+lb)return Infinity;let t=0;for(let i=0;i<lb;i++){const sl=p.slice(-(n+i),p.length-i||undefined);t+=bollinger(sl,n,m).bw;}return t/lb;}
function stochRSI(p,n=14){if(p.length<n*2)return null;const a=[];for(let i=n;i<=p.length;i++)a.push(rsi(p.slice(0,i),n));if(a.length<n)return null;const w=a.slice(-n),mn=Math.min(...w),mx=Math.max(...w);if(mx===mn)return 50;return((a[a.length-1]-mn)/(mx-mn))*100;}
function macdHisto(p){const ef=ema(p,12),es=ema(p,26);if(!ef||!es)return 0;return ef-es;}
function avgDiff(p){if(p.length<2)return 0;let s=0;for(let i=1;i<p.length;i++)s+=Math.abs(p[i]-p[i-1]);return s/(p.length-1);}
function drawdownPct(){return Math.max(0,((S.startBalance-S.lowestBalance)/S.startBalance)*100);}
function pnlPct(){return((S.balance-S.startBalance)/S.startBalance)*100;}
function winRate(){return S.trades?Math.round(S.wins/S.trades*100):0;}

// ─────────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────────
process.on('SIGINT',  ()=>{ log.warn('Shutting down...'); process.exit(0); });
process.on('SIGTERM', ()=>{ log.warn('Terminated.');      process.exit(0); });

if (CONFIG.DERIV_API_TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  log.stop('No API token! Add DERIV_API_TOKEN to Railway Variables and redeploy.');
  process.exit(1);
}

console.log(chalk.green('\n  ⚡ DERIV EA BOT — SERVER EDITION (Railway)'));
console.log(chalk.gray('  ─────────────────────────────────────────'));
console.log(chalk.yellow(`  Mode    : ${CONFIG.DEMO_MODE?'DEMO':'🔴 LIVE'}`));
console.log(chalk.cyan( `  Index   : ${CONFIG.INSTRUMENT}`));
console.log(chalk.cyan( `  Stake   : $${CONFIG.BASE_STAKE}`));
console.log(chalk.cyan( `  Target  : +${CONFIG.DAILY_TARGET}%  |  Max DD: ${CONFIG.MAX_DAILY_DD}%`));
console.log(chalk.cyan( `  Port    : ${CONFIG.PORT}\n`));

connect();
