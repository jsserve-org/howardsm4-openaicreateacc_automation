import { listEmails } from '@/server/email-store';
import { startMailPoller } from '@/server/mail-poller';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  startMailPoller();

  if (process.env.MAIL_API_TOKEN) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${process.env.MAIL_API_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const url = new URL(req.url);
  const email = url.searchParams.get('email');
  if (!email) return new Response(JSON.stringify({ error: 'email param required' }), { status: 400 });

  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
  const messages = await listEmails(email, limit);
  return Response.json(
    messages.map((m) => ({
      to: m.to_addr,
      from: m.from_addr,
      subject: m.subject,
      code: m.code,
      body: m.raw,
      receivedAt: m.received_at,
    })),
  );
}
