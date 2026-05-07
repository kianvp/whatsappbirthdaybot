import jwt from 'jsonwebtoken';

export function requireAuth(db) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(payload.id);
      if (!user) return res.status(401).json({ error: 'User not found or suspended' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

export function requireAdmin(db) {
  return async (req, res, next) => {
    const mw = requireAuth(db);
    mw(req, res, () => {
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
      next();
    });
  };
}
