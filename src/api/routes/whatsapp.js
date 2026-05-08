import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export default function whatsappRoutes(db, botManager) {
  const router = Router();

  // Start the WhatsApp session (called once when user clicks Connect)
  router.post('/start', requireAuth(db), async (req, res) => {
    const info = botManager.getSessionInfo(req.user.id);
    if (info.state === 'connected' || info.state === 'connecting') {
      return res.json({ state: info.state });
    }
    botManager.startSession(req.user.id); // fire and forget
    res.json({ state: 'connecting' });
  });

  // Poll this every 2s — returns current state + QR if available
  router.get('/qr', requireAuth(db), (req, res) => {
    const { state, qr } = botManager.getSessionInfo(req.user.id);
    res.json({ state, qr });
  });

  // Send a test birthday message to a specific group
  router.post('/test', requireAuth(db), async (req, res) => {
    const { groupId } = req.body;
    if (!groupId) return res.status(400).json({ error: 'groupId is required' });

    const group = await db.prepare(
      'SELECT * FROM groups WHERE id = ? AND user_id = ?'
    ).get(groupId, req.user.id);

    if (!group) return res.status(404).json({ error: 'Group not found' });

    const DEFAULT_MESSAGE = `🎂 Happy Birthday {name}! 🎉 Wishing you an incredible day filled with joy and celebration! From all of us in this group, have an amazing birthday! 🥳`;
    const template = group.custom_message || DEFAULT_MESSAGE;
    const message = template.replace('{name}', 'John (turning 30)');

    try {
      await botManager.sendMessage(req.user.id, group.group_jid, message);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/disconnect', requireAuth(db), async (req, res) => {
    await botManager.stopSession(req.user.id);
    res.json({ success: true });
  });

  router.get('/status', requireAuth(db), (req, res) => {
    res.json({ status: botManager.getStatus(req.user.id) });
  });

  // Sync groups from WhatsApp into DB
  router.post('/sync-groups', requireAuth(db), async (req, res) => {
    const session = botManager.sessions.get(req.user.id);
    if (!session || session.state !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }
    await botManager._syncGroups(req.user.id, session.sock);
    const groups = db.prepare('SELECT * FROM groups WHERE user_id = ? AND is_active = 1').all(req.user.id);
    res.json({ groups });
  });

  return router;
}
