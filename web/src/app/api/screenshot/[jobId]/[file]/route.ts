import { auth } from '@/server/auth';
import { getJob, SCREENSHOT_DIR } from '@/server/jobs';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ jobId: string; file: string }> },
) {
  const { jobId, file } = await ctx.params;
  const session = await auth.api.getSession({ headers: req.headers });
  const email = session?.user?.email;
  if (!email) return new Response('Unauthorized', { status: 401 });

  const job = getJob(jobId, email);
  if (!job) return new Response('Not found', { status: 404 });

  // Strict allowlist: filename must match the job's recorded screenshot.
  if (!job.errorScreenshot || job.errorScreenshot !== file) {
    return new Response('Not found', { status: 404 });
  }

  const filePath = path.join(SCREENSHOT_DIR, jobId, file);
  // Defence-in-depth against path traversal.
  if (!filePath.startsWith(path.join(SCREENSHOT_DIR, jobId) + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = fs.readFileSync(filePath);
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
