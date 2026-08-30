# OPTION B — Host Bot on Railway.app (24/7 Server)

## What this is
The bot runs on a cloud server — it trades even when your phone
and laptop are completely off. You get a live dashboard URL you
can open from anywhere to check balance, P&L, and trades.

---

## What you need
- A free GitHub account → https://github.com
- A free Railway account → https://railway.app
- Your Deriv API token (from deriv.com)
- These 4 files: bot.js · package.json · .env.example · .gitignore

---

## PART 1 — Put bot files on GitHub (5 min)

### Step 1 — Create a GitHub account
Go to https://github.com → click Sign Up → follow the steps.
GitHub is free. Use any email.

### Step 2 — Create a new repository
1. Once logged in, click the **+** button (top right)
2. Click **New repository**
3. Name it: `deriv-bot`
4. Set visibility to: ● **Private** (keeps your code secret)
5. Leave everything else as default
6. Click **Create repository**

### Step 3 — Upload your bot files
On the repository page you'll see a message saying the repo is empty.
1. Click **uploading an existing file**
2. Drag and drop ALL 4 files:
   - `bot.js`
   - `package.json`
   - `.env.example`
   - `.gitignore`
3. Scroll down and click **Commit changes**

Your files are now on GitHub. ✅

---

## PART 2 — Deploy to Railway (10 min)

### Step 4 — Create a Railway account
1. Go to https://railway.app
2. Click **Login** → **Login with GitHub**
3. Authorize Railway to access your GitHub

### Step 5 — Create a new project
1. Click **New Project**
2. Click **Deploy from GitHub repo**
3. If you don't see your repo, click **Configure GitHub App**
   and grant Railway access to `deriv-bot`
4. Click your `deriv-bot` repository
5. Railway starts building automatically (takes ~60 seconds)

### Step 6 — Add your environment variables ⚠ CRITICAL
Without these, the bot won't start. Add them now:

1. In Railway, click on your service (the card that appeared)
2. Click the **Variables** tab
3. Click **New Variable** and add each one:

| Variable name      | Value to enter              |
|--------------------|-----------------------------|
| DERIV_API_TOKEN    | your token from Deriv       |
| DEMO_MODE          | true                        |
| INSTRUMENT         | BOOM500                     |
| BASE_STAKE         | 0.35                        |
| MAX_DAILY_DD       | 10                          |
| DAILY_TARGET       | 15                          |
| MARTINGALE         | true                        |
| MARTI_MULT         | 1.8                         |
| MARTI_MAX_LEVEL    | 3                           |

4. After adding all variables, Railway redeploys automatically.

### Step 7 — Get your dashboard URL
1. Click your service → **Settings** tab
2. Scroll to **Networking** section
3. Click **Generate Domain**
4. Railway gives you a URL like:
   `https://deriv-bot-production-xxxx.up.railway.app`
5. Open it — you'll see your live dashboard! 🎉

---

## PART 3 — Monitor from anywhere

Your dashboard URL works on any device — phone, tablet, laptop.
It shows:
- ✅ Live balance and P&L
- ✅ Win rate and trade count
- ✅ Drawdown meter
- ✅ Recent trade list
- ✅ Full activity log
- ✅ Auto-refreshes every 10 seconds

Bookmark it on your phone.

---

## PART 4 — Go live with real money

After running DEMO mode for several sessions and confirming
the win rate is above 50%:

1. Go to Railway → your service → **Variables** tab
2. Find `DEMO_MODE`
3. Change the value from `true` to `false`
4. Railway redeploys automatically in ~30 seconds
5. Bot starts trading real money 🔴

---

## Changing any setting

ALL settings are controlled from Railway → Variables.
Change any value → Railway redeploys in ~30 seconds.
No need to touch any code.

Examples:
- Switch index: change INSTRUMENT to CRASH500
- Increase stake: change BASE_STAKE to 1.00
- Tighten risk: change MAX_DAILY_DD to 7

---

## Cost

Railway free tier gives you $5 credit/month.
Running this bot 24/7 costs roughly $0.50–$1.00/month.
No credit card required to start.

---

## Stopping the bot temporarily

In Railway → Variables → change DEMO_MODE to `true`
(this makes it paper trade instead of real trade)

To fully stop: Railway → your service → **Settings** → **Remove service**

---

## Troubleshooting

**Bot shows "STOPPED" on dashboard**
→ Either the daily profit target or drawdown limit was hit.
→ It automatically resets at midnight UTC.

**Dashboard shows nothing / blank page**
→ Wait 60 seconds after deployment — the bot needs time to start.
→ Check Railway → your service → **Logs** tab for error messages.

**"Auth failed" in logs**
→ Your API token is wrong or expired.
→ Get a fresh token from deriv.com → API Token.
→ Update DERIV_API_TOKEN in Railway Variables.

---

## ⚠ Risk reminder
Always run on DEMO for several days first.
Never trade money you cannot afford to lose.
