import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, ...
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Thin async wrapper that mimics better-sqlite3 API
function createDB(pool) {
  return {
    async exec(sql) {
      await pool.query(sql);
    },

    prepare(sql) {
      const pgSql = toPostgres(sql);
      const isInsert = /^\s*INSERT/i.test(pgSql);
      const hasReturning = /RETURNING/i.test(pgSql);

      return {
        async get(...args) {
          const params = args.flat().filter(a => a !== undefined);
          const { rows } = await pool.query(pgSql, params.length ? params : undefined);
          return rows[0];
        },

        async all(...args) {
          const params = args.flat().filter(a => a !== undefined);
          const { rows } = await pool.query(pgSql, params.length ? params : undefined);
          return rows;
        },

        async run(...args) {
          const params = args.flat().filter(a => a !== undefined);
          // Auto-add RETURNING id for INSERT so we get lastInsertRowid
          const finalSql = isInsert && !hasReturning ? pgSql + ' RETURNING id' : pgSql;
          try {
            const { rows, rowCount } = await pool.query(finalSql, params.length ? params : undefined);
            return { lastInsertRowid: rows[0]?.id ?? null, changes: rowCount };
          } catch (e) {
            // If RETURNING id fails (e.g. ON CONFLICT DO NOTHING returned 0 rows) retry without
            if (isInsert) {
              const { rowCount } = await pool.query(pgSql, params.length ? params : undefined);
              return { lastInsertRowid: null, changes: rowCount };
            }
            throw e;
          }
        },
      };
    },
  };
}

export async function initDB() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // Test connection
  await pool.query('SELECT 1');
  console.log('Database connected');

  const db = createDB(pool);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      plan TEXT DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'inactive',
      subscription_ends_at INTEGER,
      whatsapp_connected INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_jid TEXT NOT NULL,
      group_name TEXT NOT NULL,
      custom_message TEXT,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE(user_id, group_jid)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS birthdays (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      person_name TEXT NOT NULL,
      birth_day INTEGER NOT NULL,
      birth_month INTEGER NOT NULL,
      birth_year INTEGER,
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS birthday_logs (
      id SERIAL PRIMARY KEY,
      birthday_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      sent_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      success INTEGER DEFAULT 1,
      error TEXT
    )
  `);

  // Seed admin
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(process.env.ADMIN_EMAIL);
    if (!existing) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await db.prepare(
        "INSERT INTO users (email, password_hash, name, is_admin, plan) VALUES (?, ?, 'Admin', 1, 'business')"
      ).run(process.env.ADMIN_EMAIL, hash);
      console.log('Admin account created:', process.env.ADMIN_EMAIL);
    }
  }

  return db;
}
