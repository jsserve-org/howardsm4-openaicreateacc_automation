// Background IMAP poller. Connects to the configured IMAP mailbox (Cloudflare
// Email Routing forwards everything for *@your-domain there) and ingests new
// messages into Postgres on a tight loop. No Cloudflare Worker / KV needed.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { storeEmail } from './email-store';

let started = false;
let stopRequested = false;

export function startMailPoller() {
  if (started) return;
  if (process.env.MAIL_POLLER_DISABLED === 'true') {
    console.log('[mail-poller] disabled via env');
    return;
  }
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
    console.log('[mail-poller] missing IMAP_* env, skipping');
    return;
  }
  started = true;
  void run();
}

export function stopMailPoller() {
  stopRequested = true;
}

async function run() {
  const host = process.env.IMAP_HOST!;
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.IMAP_USER!;
  const pass = process.env.IMAP_PASSWORD!;
  const mailbox = process.env.IMAP_MAILBOX || 'INBOX';
  const intervalMs = Number(process.env.IMAP_POLL_INTERVAL_MS || 4000);
  const lookbackDays = Number(process.env.IMAP_LOOKBACK_DAYS || 1);

  const startTime = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

  while (!stopRequested) {
    let client: ImapFlow | null = null;
    try {
      client = new ImapFlow({
        host, port, secure: port === 993,
        auth: { user, pass },
        logger: false,
      });
      await client.connect();
      const lock = await client.getMailboxLock(mailbox);
      try {
        // Use IDLE if the server supports it for instant pickup; otherwise
        // fall back to polling SEARCH every interval.
        await drainNew(client, startTime);
        await new Promise((r) => setTimeout(r, intervalMs));
      } finally {
        lock.release();
        await client.logout().catch(() => {});
      }
    } catch (e: any) {
      console.error('[mail-poller] error:', e?.message ?? e);
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      try { await client?.close?.(); } catch {}
    }
  }
}

async function drainNew(client: ImapFlow, since: Date) {
  // Search for messages received since the lookback time. We dedupe in DB by
  // Message-Id, so reprocessing is cheap and safe.
  const uids = await client.search({ since });
  if (!uids || uids.length === 0) return;

  for await (const msg of client.fetch(uids, { envelope: true, source: true, uid: true })) {
    try {
      const raw = msg.source?.toString('utf8') ?? '';
      const parsed = await simpleParser(raw).catch(() => null as any);
      const to = pickAddress(parsed?.to ?? msg.envelope?.to ?? null);
      if (!to) continue;
      const from = pickAddress(parsed?.from ?? msg.envelope?.from ?? null);
      const subject = parsed?.subject ?? msg.envelope?.subject ?? null;
      const messageId = parsed?.messageId ?? msg.envelope?.messageId ?? null;
      const { code } = await storeEmail({ to, from, subject, raw, messageId });
      console.log('[mail-poller] stored', { to, from, subject, code });
    } catch (e: any) {
      console.error('[mail-poller] parse/store error:', e?.message ?? e);
    }
  }
}

function pickAddress(field: any): string | null {
  if (!field) return null;
  if (Array.isArray(field)) return pickAddress(field[0]);
  if (typeof field === 'string') return field;
  if (field.address) return field.address;
  if (field.value && field.value[0]?.address) return field.value[0].address;
  if (field.text) {
    // mailparser sometimes returns parsed `to` with `.text`.
    const m = field.text.match(/[^\s<>"']+@[^\s<>"']+/);
    return m ? m[0] : null;
  }
  return null;
}
