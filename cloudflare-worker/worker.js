export default {
  async email(message, env, ctx) {
    const to = (message.to || '').toLowerCase();
    const from = message.from;
    const subject = message.headers.get('subject') || '';
    const rawBody = await new Response(message.raw).text();

    const code = extractVerificationCode(rawBody);

    // Log every incoming message so `wrangler tail` shows codes as they
    // arrive — useful when debugging accounts that didn't auto-verify.
    console.log(JSON.stringify({
      kind: 'inbound_email',
      to,
      from,
      subject,
      code,
      bytes: rawBody.length,
      receivedAt: new Date().toISOString(),
    }));

    const emailData = {
      to,
      from,
      subject,
      code,
      body: rawBody.substring(0, 4000),
      receivedAt: new Date().toISOString(),
    };

    const emailKey = `email:${to}`;
    const existing = await env.EMAIL_KV.get(emailKey, { type: 'json' }) || [];
    existing.push(emailData);
    await env.EMAIL_KV.put(emailKey, JSON.stringify(existing), { expirationTtl: 3600 });

    if (code) {
      await env.EMAIL_KV.put(`code:${to}`, JSON.stringify({ code, receivedAt: emailData.receivedAt }), { expirationTtl: 600 });
    }

    if (env.FORWARD_EMAIL) {
      await message.forward(env.FORWARD_EMAIL);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const authHeader = request.headers.get('Authorization');
    const expectedToken = `Bearer ${env.API_TOKEN}`;

    if (authHeader !== expectedToken) {
      return new Response('Unauthorized', { status: 401 });
    }

    const path = url.pathname;

    if (path === '/get-code') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      if (!email) return new Response(JSON.stringify({ error: 'email param required' }), { status: 400 });

      const data = await env.EMAIL_KV.get(`code:${email}`, { type: 'json' });
      console.log(JSON.stringify({ kind: 'get_code', email, hit: !!data, code: data?.code ?? null }));
      if (!data) return new Response(JSON.stringify({ code: null }), { status: 404 });

      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/get-emails') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      if (!email) return new Response(JSON.stringify({ error: 'email param required' }), { status: 400 });

      const data = await env.EMAIL_KV.get(`email:${email}`, { type: 'json' });
      return new Response(JSON.stringify(data || []), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/clear-emails' && request.method === 'POST') {
      const body = await request.json();
      const email = (body.email || '').toLowerCase();
      if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400 });

      await env.EMAIL_KV.delete(`email:${email}`);
      await env.EMAIL_KV.delete(`code:${email}`);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

function decodeQuotedPrintable(s) {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeBase64Loose(s) {
  try {
    const cleaned = s.replace(/[^A-Za-z0-9+/=]/g, '');
    return atob(cleaned);
  } catch {
    return '';
  }
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// Pull the verification code out of a full raw MIME email.
// Strategy: drop headers, decode common transfer encodings, strip HTML,
// then prefer 6-digit numbers that appear near "code"/"verify" keywords.
function extractVerificationCode(raw) {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  let body = headerEnd >= 0 ? raw.slice(headerEnd) : raw;

  // Decode any quoted-printable parts.
  let decoded = decodeQuotedPrintable(body);

  // If the message is base64-encoded, try that too and append.
  const base64Match = body.match(/Content-Transfer-Encoding:\s*base64[^]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/i);
  if (base64Match) {
    decoded += '\n' + decodeBase64Loose(base64Match[1]);
  }

  decoded = stripHtml(decoded);

  // Prefer codes near keywords.
  const keywordPatterns = [
    /(?:verification\s*code|your\s*code|enter\s*(?:the\s*)?code|one[-\s]?time\s*(?:code|password|passcode)|otp|passcode|code\s*(?:is|:))[^\d]{0,40}(\d{4,8})/i,
    /(\d{4,8})[^\d]{0,40}(?:is\s*your|verification\s*code)/i,
  ];
  for (const re of keywordPatterns) {
    const m = decoded.match(re);
    if (m) return m[1];
  }

  // Fallback: prefer 6-digit numbers on their own line (typical of big-display codes).
  const lineMatch = decoded.match(/(?:^|\n)\s*(\d{6})\s*(?:\r?\n|$)/);
  if (lineMatch) return lineMatch[1];

  // Last resort: any standalone 6-digit number in the body, but skip ones that
  // look like timestamps (start with 17 / 18 / 19 / 20).
  const all = [...decoded.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  const filtered = all.filter((n) => !/^(?:17|18|19|20)/.test(n));
  return filtered[0] || all[0] || null;
}
