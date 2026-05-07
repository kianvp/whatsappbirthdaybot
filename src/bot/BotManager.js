import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, '../../sessions');
const logger = pino({ level: 'silent' });

export class BotManager {
  constructor(db) {
    this.db = db;
    this.sessions = new Map();
    this.reconnectAttempts = new Map();
  }

  async startSession(userId) {
    if (this.sessions.has(userId)) {
      const session = this.sessions.get(userId);
      if (session.state === 'connected' || session.state === 'connecting') return;
    }

    this._setState(userId, 'connecting', null);
    const sessionDir = join(SESSIONS_DIR, String(userId));

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: ['BirthdayBot', 'Chrome', '120.0'],
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        retryRequestDelayMs: 500,
        generateHighQualityLinkPreview: false,
      });

      const session = this.sessions.get(userId) || {};
      session.sock = sock;
      session.saveCreds = saveCreds;
      this.sessions.set(userId, session);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrDataUrl = await QRCode.toDataURL(qr);
          this._setState(userId, 'connecting', qrDataUrl);
          console.log(`[Bot] QR generated for user ${userId}`);
        }

        if (connection === 'open') {
          this._setState(userId, 'connected', null);
          this.reconnectAttempts.set(userId, 0);
          await this.db.prepare('UPDATE users SET whatsapp_connected = 1 WHERE id = ?').run(userId);
          console.log(`[Bot] User ${userId} connected`);
          await this._syncGroups(userId, sock);
        }

        if (connection === 'close') {
          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          this._setState(userId, 'disconnected', null);
          await this.db.prepare('UPDATE users SET whatsapp_connected = 0 WHERE id = ?').run(userId);
          console.log(`[Bot] User ${userId} disconnected (loggedOut: ${loggedOut})`);

          if (!loggedOut) {
            const attempts = (this.reconnectAttempts.get(userId) || 0) + 1;
            this.reconnectAttempts.set(userId, attempts);
            const delay = Math.min(1000 * 2 ** attempts, 60_000);
            setTimeout(() => this.startSession(userId), delay);
          } else {
            this.sessions.delete(userId);
            this.reconnectAttempts.delete(userId);
          }
        }
      });

    } catch (err) {
      console.error(`[Bot] Failed to start session for user ${userId}:`, err.message);
      this._setState(userId, 'error', null);
    }
  }

  async stopSession(userId) {
    const session = this.sessions.get(userId);
    if (!session) return;
    try { await session.sock?.logout(); } catch (_) {}
    session.sock?.end();
    this.sessions.delete(userId);
    this.reconnectAttempts.delete(userId);
    await this.db.prepare('UPDATE users SET whatsapp_connected = 0 WHERE id = ?').run(userId);
  }

  async sendMessage(userId, groupJid, message) {
    const session = this.sessions.get(userId);
    if (!session || session.state !== 'connected') throw new Error('WhatsApp not connected');
    await session.sock.sendMessage(groupJid, { text: message });
  }

  getSessionInfo(userId) {
    const session = this.sessions.get(userId);
    return { state: session?.state || 'disconnected', qr: session?.qr || null };
  }

  getStatus(userId) {
    return this.getSessionInfo(userId).state;
  }

  async restoreActiveSessions() {
    const users = await this.db.prepare(
      'SELECT id FROM users WHERE is_active = 1 AND whatsapp_connected = 1'
    ).all();
    console.log(`Restoring ${users.length} WhatsApp session(s)...`);
    for (const user of users) {
      await this.startSession(user.id);
    }
  }

  _setState(userId, state, qr) {
    const existing = this.sessions.get(userId) || {};
    existing.state = state;
    existing.qr = qr;
    this.sessions.set(userId, existing);
  }

  async _syncGroups(userId, sock) {
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const [jid, meta] of Object.entries(groups)) {
        await this.db.prepare(`
          INSERT INTO groups (user_id, group_jid, group_name)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, group_jid) DO UPDATE SET group_name = EXCLUDED.group_name
        `).run(userId, jid, meta.subject || 'Unknown Group');
      }
      console.log(`[Bot] Synced groups for user ${userId}`);
    } catch (err) {
      console.error(`[Bot] Failed to sync groups for user ${userId}:`, err.message);
    }
  }
}
