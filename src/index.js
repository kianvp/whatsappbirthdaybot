import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

import { initDB } from './db/database.js';
import { BotManager } from './bot/BotManager.js';
import { startScheduler } from './bot/scheduler.js';
import authRoutes from './api/routes/auth.js';
import whatsappRoutes from './api/routes/whatsapp.js';
import groupRoutes from './api/routes/groups.js';
import birthdayRoutes from './api/routes/birthdays.js';
import billingRoutes from './api/routes/billing.js';
import adminRoutes from './api/routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Stripe webhooks need raw body — must be before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(cors());
app.use(express.static(join(__dirname, '../public')));

const db = await initDB();
const botManager = new BotManager(db);

app.use('/api/auth', authRoutes(db));
app.use('/api/whatsapp', whatsappRoutes(db, botManager));
app.use('/api/groups', groupRoutes(db));
app.use('/api/birthdays', birthdayRoutes(db));
app.use('/api/billing', billingRoutes(db));
app.use('/api/admin', adminRoutes(db, botManager));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

const server = app.listen(PORT, async () => {
  console.log(`BirthdayBot running on port ${PORT}`);
  await botManager.restoreActiveSessions();
  startScheduler(db, botManager);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill other node processes and restart.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
