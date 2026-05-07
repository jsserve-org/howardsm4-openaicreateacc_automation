import { latestCode } from '@/server/email-store';
import { startMailPoller } from '@/server/mail-poller';

export const dynamic = 'force-dynamic';

// Open endpoint (the burner email is the secret). Auth via MAIL_API_TOKEN
// when the env is set.
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

  const hit = await latestCode(email);
  if (!hit) return new Response(JSON.stringify({ code: null }), { status: 404 });
  return Response.json({ code: hit.code, receivedAt: hit.receivedAt });
}
