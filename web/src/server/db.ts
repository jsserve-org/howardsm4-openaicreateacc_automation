import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  pool.on('error', (e) => console.error('[pg pool]', e));
  return pool;
}

let initialized = false;

export async function ensureSchema() {
  if (initialized) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS inbound_emails (
      id BIGSERIAL PRIMARY KEY,
      to_addr TEXT NOT NULL,
      from_addr TEXT,
      subject TEXT,
      code TEXT,
      raw TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      message_id TEXT
    );
    CREATE INDEX IF NOT EXISTS inbound_emails_to_received_idx
      ON inbound_emails (to_addr, received_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS inbound_emails_msgid_uidx
      ON inbound_emails (message_id) WHERE message_id IS NOT NULL;
  `);
  initialized = true;
}

export async function query<T = any>(sql: string, params: any[] = []) {
  await ensureSchema();
  const res = await getPool().query<T>(sql, params);
  return res;
}
