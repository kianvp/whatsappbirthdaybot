import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const FREE_BIRTHDAY_LIMIT = 15;

export default function birthdayRoutes(db) {
  const router = Router();

  router.get('/group/:groupId', requireAuth(db), async (req, res) => {
    const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const birthdays = await db.prepare(
      'SELECT * FROM birthdays WHERE group_id = ? ORDER BY birth_month, birth_day'
    ).all(group.id);
    res.json(birthdays);
  });

  router.post('/group/:groupId', requireAuth(db), async (req, res) => {
    const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(req.params.groupId, req.user.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    if (req.user.plan === 'free') {
      const row = await db.prepare(`
        SELECT COUNT(*) as c FROM birthdays b
        JOIN groups g ON g.id = b.group_id
        WHERE g.user_id = ?
      `).get(req.user.id);
      if (Number(row.c) >= FREE_BIRTHDAY_LIMIT) {
        return res.status(403).json({ error: `Free plan allows max ${FREE_BIRTHDAY_LIMIT} birthdays total. Upgrade to Pro for unlimited.` });
      }
    }

    const { person_name, birth_day, birth_month, birth_year } = req.body;
    if (!person_name || !birth_day || !birth_month) {
      return res.status(400).json({ error: 'person_name, birth_day, birth_month required' });
    }
    if (birth_day < 1 || birth_day > 31 || birth_month < 1 || birth_month > 12) {
      return res.status(400).json({ error: 'Invalid date' });
    }

    const result = await db.prepare(
      'INSERT INTO birthdays (group_id, person_name, birth_day, birth_month, birth_year) VALUES (?, ?, ?, ?, ?)'
    ).run(group.id, person_name.trim(), birth_day, birth_month, birth_year || null);

    res.json(await db.prepare('SELECT * FROM birthdays WHERE id = ?').get(result.lastInsertRowid));
  });

  router.put('/:id', requireAuth(db), async (req, res) => {
    const birthday = await db.prepare(`
      SELECT b.* FROM birthdays b
      JOIN groups g ON g.id = b.group_id
      WHERE b.id = ? AND g.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!birthday) return res.status(404).json({ error: 'Birthday not found' });

    const { person_name, birth_day, birth_month, birth_year } = req.body;
    await db.prepare(`
      UPDATE birthdays SET
        person_name = COALESCE(?, person_name),
        birth_day = COALESCE(?, birth_day),
        birth_month = COALESCE(?, birth_month),
        birth_year = ?
      WHERE id = ?
    `).run(person_name || null, birth_day || null, birth_month || null, birth_year ?? birthday.birth_year, birthday.id);

    res.json(await db.prepare('SELECT * FROM birthdays WHERE id = ?').get(birthday.id));
  });

  router.delete('/:id', requireAuth(db), async (req, res) => {
    const birthday = await db.prepare(`
      SELECT b.id FROM birthdays b
      JOIN groups g ON g.id = b.group_id
      WHERE b.id = ? AND g.user_id = ?
    `).get(req.params.id, req.user.id);
    if (!birthday) return res.status(404).json({ error: 'Birthday not found' });
    await db.prepare('DELETE FROM birthdays WHERE id = ?').run(birthday.id);
    res.json({ success: true });
  });

  router.get('/upcoming', requireAuth(db), async (req, res) => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    const birthdays = await db.prepare(`
      SELECT b.*, g.group_name FROM birthdays b
      JOIN groups g ON g.id = b.group_id
      WHERE g.user_id = ? AND g.is_active = 1
      ORDER BY
        CASE WHEN (b.birth_month > ? OR (b.birth_month = ? AND b.birth_day >= ?))
          THEN b.birth_month * 100 + b.birth_day
          ELSE b.birth_month * 100 + b.birth_day + 1200
        END
      LIMIT 10
    `).all(req.user.id, month, month, day);

    res.json(birthdays);
  });

  return router;
}
