import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';

export default function authRoutes(db) {
  const router = Router();

  router.post('/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.prepare(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
    ).run(email.toLowerCase().trim(), hash, name.trim());

    const token = jwt.sign({ id: result.lastInsertRowid }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, name: name.trim(), plan: 'free' });
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(403).json({ error: 'Account suspended' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      name: user.name,
      plan: user.plan,
      is_admin: !!user.is_admin,
      whatsapp_connected: !!user.whatsapp_connected,
    });
  });

  router.get('/me', requireAuth(db), (req, res) => {
    const u = req.user;
    res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan,
      is_admin: !!u.is_admin,
      whatsapp_connected: !!u.whatsapp_connected,
      subscription_status: u.subscription_status,
      subscription_ends_at: u.subscription_ends_at,
    });
  });

  return router;
}
