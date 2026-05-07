import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';

export default function adminRoutes(db, botManager) {
  const router = Router();

  router.get('/stats', requireAdmin(db), async (req, res) => {
    const [tu, au, cs, tg, tb, mt, pc] = await Promise.all([
      db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 0').get(),
      db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1 AND is_admin = 0').get(),
      db.prepare('SELECT COUNT(*) as c FROM users WHERE whatsapp_connected = 1').get(),
      db.prepare('SELECT COUNT(*) as c FROM groups').get(),
      db.prepare('SELECT COUNT(*) as c FROM birthdays').get(),
      db.prepare('SELECT COUNT(*) as c FROM birthday_logs WHERE sent_at >= EXTRACT(EPOCH FROM NOW())::INTEGER - 86400 AND success = 1').get(),
      db.prepare("SELECT COUNT(*) as c FROM users WHERE subscription_status = 'active' AND is_admin = 0").get(),
    ]);
    res.json({
      total_users: Number(tu.c),
      active_users: Number(au.c),
      connected_sessions: Number(cs.c),
      total_groups: Number(tg.c),
      total_birthdays: Number(tb.c),
      messages_today: Number(mt.c),
      paying_customers: Number(pc.c),
    });
  });

  router.get('/users', requireAdmin(db), async (req, res) => {
    const users = await db.prepare(`
      SELECT u.id, u.email, u.name, u.plan, u.is_active, u.whatsapp_connected,
             u.subscription_status, u.created_at,
             COUNT(DISTINCT g.id) as group_count,
             COUNT(DISTINCT b.id) as birthday_count
      FROM users u
      LEFT JOIN groups g ON g.user_id = u.id
      LEFT JOIN birthdays b ON b.group_id = g.id
      WHERE u.is_admin = 0
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  });

  router.post('/users/:id/toggle', requireAdmin(db), async (req, res) => {
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newActive = user.is_active ? 0 : 1;
    await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newActive, user.id);

    if (!newActive) await botManager.stopSession(user.id);
    res.json({ is_active: newActive });
  });

  router.post('/users/:id/disconnect', requireAdmin(db), async (req, res) => {
    await botManager.stopSession(Number(req.params.id));
    res.json({ success: true });
  });

  router.get('/logs', requireAdmin(db), async (req, res) => {
    const logs = await db.prepare(`
      SELECT l.*, u.email, u.name, g.group_name, b.person_name
      FROM birthday_logs l
      JOIN users u ON u.id = l.user_id
      JOIN groups g ON g.id = l.group_id
      JOIN birthdays b ON b.id = l.birthday_id
      ORDER BY l.sent_at DESC
      LIMIT 100
    `).all();
    res.json(logs);
  });

  return router;
}
