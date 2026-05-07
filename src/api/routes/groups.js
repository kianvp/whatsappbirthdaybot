import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const PLAN_LIMITS = { free: 2, pro: 10, business: Infinity };

export default function groupRoutes(db) {
  const router = Router();

  router.get('/', requireAuth(db), async (req, res) => {
    const groups = await db.prepare(`
      SELECT g.*, COUNT(b.id) AS birthday_count
      FROM groups g
      LEFT JOIN birthdays b ON b.group_id = g.id
      WHERE g.user_id = ?
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `).all(req.user.id);
    res.json(groups);
  });

  router.post('/', requireAuth(db), async (req, res) => {
    const { group_jid, group_name, custom_message } = req.body;
    if (!group_jid || !group_name) return res.status(400).json({ error: 'group_jid and group_name required' });

    const limit = PLAN_LIMITS[req.user.plan] ?? 2;
    const { c } = await db.prepare('SELECT COUNT(*) as c FROM groups WHERE user_id = ? AND is_active = 1').get(req.user.id);
    if (Number(c) >= limit) {
      return res.status(403).json({ error: `Your ${req.user.plan} plan allows max ${limit} groups. Upgrade to add more.` });
    }

    try {
      const result = await db.prepare(
        'INSERT INTO groups (user_id, group_jid, group_name, custom_message) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, group_jid) DO NOTHING'
      ).run(req.user.id, group_jid, group_name, custom_message || null);

      const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
      res.json(group);
    } catch (err) {
      if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
        return res.status(409).json({ error: 'Group already added' });
      }
      throw err;
    }
  });

  router.put('/:id', requireAuth(db), async (req, res) => {
    const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { group_name, custom_message, is_active } = req.body;
    await db.prepare(`
      UPDATE groups SET
        group_name = COALESCE(?, group_name),
        custom_message = ?,
        is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).run(group_name || null, custom_message ?? group.custom_message, is_active ?? null, group.id);

    res.json(await db.prepare('SELECT * FROM groups WHERE id = ?').get(group.id));
  });

  router.delete('/:id', requireAuth(db), async (req, res) => {
    const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
    res.json({ success: true });
  });

  return router;
}
