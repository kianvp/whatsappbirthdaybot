# BirthdayBot — WhatsApp Birthday SaaS

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` and fill in:
- `JWT_SECRET` — any long random string (e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your admin login
- Stripe keys (see below)
- `APP_URL` — your deployed URL

### 3. Set up Stripe
1. Create account at https://stripe.com
2. Go to Products → Create two products:
   - **BirthdayBot Pro** — $7/month recurring → copy Price ID → `STRIPE_PRO_PRICE_ID`
   - **BirthdayBot Business** — $19/month recurring → copy Price ID → `STRIPE_BUSINESS_PRICE_ID`
3. Go to API Keys → copy Secret Key → `STRIPE_SECRET_KEY`
4. Go to Webhooks → Add endpoint → URL: `https://your-app.com/api/billing/webhook`
   - Events to listen for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET`
5. Enable **Customer Portal** at https://dashboard.stripe.com/settings/billing/portal

### 4. Run locally
```bash
npm start
```
Visit http://localhost:3000

---

## Deploying Free (Oracle Cloud Always Free)

This is the best free host — 2 VMs with 1GB RAM, **never expires**, no credit card charges.

1. Sign up at https://cloud.oracle.com/free
2. Create an **Ampere A1** VM (ARM, 1GB RAM, 1 OCPU — free tier)
3. SSH into your VM:
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone your repo
git clone https://github.com/YOUR/repo.git
cd whatsapp-birthday-bot
npm install

# Set up environment
cp .env.example .env
nano .env   # fill in your values

# Install PM2 to keep it running forever
sudo npm install -g pm2
pm2 start npm --name birthdaybot -- start
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```
4. Open port 3000 in Oracle's Security List (or use nginx as a reverse proxy on port 80/443)

### Alternative: Render.com
1. Push code to GitHub
2. New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables in the Render dashboard

> ⚠️ Render's free tier **sleeps after 15 minutes of inactivity**. Use Oracle Cloud or pay $7/mo for Render's starter tier for true 24/7.

---

## How customers use it

1. Sign up at your URL → free account created
2. Go to **WhatsApp** → click Connect → scan QR code with their phone
3. Go to **Groups** → their groups appear automatically after connecting
4. Go to **Birthdays** → select a group → add names + dates
5. Every morning at 8 AM, the bot sends birthday messages automatically

---

## Admin panel

Visit `/admin.html` and log in with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

From there you can:
- See total users, paying customers, live sessions
- **Suspend any user** (instantly disconnects their bot)
- **Disconnect a user's WhatsApp** without suspending them
- View all birthday messages sent (logs)

---

## Plans & limits

| Plan | Groups | Birthdays | Custom Message | Price |
|------|--------|-----------|----------------|-------|
| Free | 2 | 15 total | No | $0 |
| Pro | 10 | Unlimited | Yes | $7/mo |
| Business | Unlimited | Unlimited | Yes | $19/mo |

---

## Project structure

```
src/
  index.js              — Express server entry point
  db/database.js        — SQLite schema + init
  bot/BotManager.js     — Multi-session WhatsApp manager (Baileys)
  bot/scheduler.js      — Daily birthday cron job (runs at 8 AM)
  api/middleware/auth.js — JWT auth + admin guard
  api/routes/
    auth.js             — /api/auth/*
    whatsapp.js         — /api/whatsapp/*
    groups.js           — /api/groups/*
    birthdays.js        — /api/birthdays/*
    billing.js          — /api/billing/* (Stripe)
    admin.js            — /api/admin/*
public/
  index.html            — Landing page with pricing
  login.html / signup.html
  dashboard.html        — Customer dashboard
  admin.html            — Admin panel
```
