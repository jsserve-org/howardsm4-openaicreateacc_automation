import { query } from './db';

// Same heuristic the worker had — strip headers and prefer codes near
// keyword markers, with a fallback that filters out timestamp-shaped numbers.
export function extractVerificationCode(raw: string): string | null {
  if (!raw) return null;
  const headerEnd = raw.search(/\r?\n\r?\n/);
  let body = headerEnd >= 0 ? raw.slice(headerEnd) : raw;
  body = body
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  body = body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

  const patterns: RegExp[] = [
    /(?:verification\s*code|your\s*code|enter\s*(?:the\s*)?code|one[-\s]?time\s*(?:code|password|passcode)|otp|passcode|code\s*(?:is|:))[^\d]{0,40}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,40}(?:is\s*your|verification\s*code)/i,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m) return m[1];
  }
  const lineMatch = body.match(/(?:^|\n)\s*(\d{6})\s*(?:\r?\n|$)/);
  if (lineMatch) return lineMatch[1];

  const all = [...body.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  const filtered = all.filter((n) => !/^(?:17|18|19|20)/.test(n));
  return filtered[0] || all[0] || null;
}

export type StoredEmail = {
  to_addr: string;
  from_addr: string | null;
  subject: string | null;
  code: string | null;
  raw: string | null;
  received_at: Date;
  message_id: string | null;
};

export async function storeEmail(input: {
  to: string;
  from?: string | null;
  subject?: string | null;
  raw: string;
  messageId?: string | null;
}) {
  const code = extractVerificationCode(input.raw);
  const to = input.to.toLowerCase();
  await query(
    `INSERT INTO inbound_emails (to_addr, from_addr, subject, code, raw, message_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
    [to, input.from ?? null, input.subject ?? null, code, input.raw, input.messageId ?? null],
  );
  return { code };
}

export async function listEmails(toAddr: string, limit = 50): Promise<StoredEmail[]> {
  const r = await query<StoredEmail>(
    `SELECT to_addr, from_addr, subject, code, LEFT(raw, 4000) AS raw, received_at, message_id
       FROM inbound_emails
      WHERE to_addr = $1
      ORDER BY received_at DESC
      LIMIT $2`,
    [toAddr.toLowerCase(), limit],
  );
  return r.rows;
}

export async function latestCode(toAddr: string): Promise<{ code: string; receivedAt: Date } | null> {
  const r = await query<{ code: string; received_at: Date }>(
    `SELECT code, received_at
       FROM inbound_emails
      WHERE to_addr = $1 AND code IS NOT NULL
      ORDER BY received_at DESC
      LIMIT 1`,
    [toAddr.toLowerCase()],
  );
  if (!r.rowCount) return null;
  return { code: r.rows[0].code, receivedAt: r.rows[0].received_at };
}
