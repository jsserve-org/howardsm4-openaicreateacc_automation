export default {
  async email(message, env, ctx) {
    const to = message.to;
    const from = message.from;
    const subject = message.headers.get('subject') || '';
    const rawBody = await new Response(message.raw).text();

    const codeMatch = rawBody.match(/\b(\d{6})\b/);
    const code = codeMatch ? codeMatch[1] : null;

    const emailData = {
      to,
      from,
      subject,
      code,
      body: rawBody.substring(0, 2000),
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
      const email = url.searchParams.get('email');
      if (!email) return new Response(JSON.stringify({ error: 'email param required' }), { status: 400 });

      const data = await env.EMAIL_KV.get(`code:${email}`, { type: 'json' });
      if (!data) return new Response(JSON.stringify({ code: null }), { status: 404 });

      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/get-emails') {
      const email = url.searchParams.get('email');
      if (!email) return new Response(JSON.stringify({ error: 'email param required' }), { status: 400 });

      const data = await env.EMAIL_KV.get(`email:${email}`, { type: 'json' });
      return new Response(JSON.stringify(data || []), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/clear-emails' && request.method === 'POST') {
      const body = await request.json();
      const email = body.email;
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
