import { randomUUID } from 'crypto';
import path from 'path';
import { createAccount } from '../../../src/lib/account-creator.js';
import { registerRemote, unregisterRemote, getRemote } from './remote';
import { query, ensureSchema } from './db';

const REPO_ROOT = path.resolve(process.cwd(), '..');
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'screenshots', 'web-jobs');

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';

export type Job = {
  id: string;
  kind: 'account' | 'codex';
  status: JobStatus;
  step: string;
  startedAt: number;
  endedAt: number | null;
  result: any;
  error: string | null;
  errorScreenshot: string | null;
  ownerEmail: string;
  log: { at: number; step: string; info: any }[];
};

export const SCREENSHOT_DIR = SCREENSHOTS_DIR;

// In-memory cache for ACTIVE jobs only — needed to keep a reference to
// in-flight Promises and the live Page (registered in remote.ts). All reads
// go through Postgres so jobs persist across container restarts.
const live = new Map<string, { job: Job; cancel: () => void }>();

export async function listJobs(ownerEmail: string): Promise<Job[]> {
  await ensureSchema();
  const r = await query<any>(
    `SELECT id, kind, status, step, started_at, ended_at, result, error,
            error_screenshot, owner_email, log
       FROM jobs
      WHERE owner_email = $1
      ORDER BY started_at DESC
      LIMIT 200`,
    [ownerEmail],
  );
  return r.rows.map(rowToJob);
}

export async function getJob(id: string, ownerEmail: string): Promise<Job | null> {
  // Live in-memory state if present (so log mutations during a run are seen
  // immediately without a DB round-trip).
  const inMem = live.get(id);
  if (inMem && inMem.job.ownerEmail === ownerEmail) return inMem.job;

  await ensureSchema();
  const r = await query<any>(
    `SELECT id, kind, status, step, started_at, ended_at, result, error,
            error_screenshot, owner_email, log
       FROM jobs
      WHERE id = $1 AND owner_email = $2`,
    [id, ownerEmail],
  );
  if (!r.rowCount) return null;
  return rowToJob(r.rows[0]);
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    step: row.step,
    startedAt: new Date(row.started_at).getTime(),
    endedAt: row.ended_at ? new Date(row.ended_at).getTime() : null,
    result: row.result,
    error: row.error,
    errorScreenshot: row.error_screenshot,
    ownerEmail: row.owner_email,
    log: row.log ?? [],
  };
}

async function persist(job: Job) {
  await query(
    `INSERT INTO jobs (id, owner_email, kind, status, step, started_at, ended_at,
                       result, error, error_screenshot, log)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),
             $7::bigint IS NULL ? NULL : to_timestamp($7/1000.0),
             $8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        step = EXCLUDED.step,
        ended_at = EXCLUDED.ended_at,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        error_screenshot = EXCLUDED.error_screenshot,
        log = EXCLUDED.log`,
    [
      job.id, job.ownerEmail, job.kind, job.status, job.step,
      job.startedAt, job.endedAt,
      job.result ? JSON.stringify(job.result) : null,
      job.error, job.errorScreenshot, JSON.stringify(job.log),
    ],
  ).catch((e) => console.error('[jobs] persist error:', e?.message ?? e));
}

// Helper that survives the SQL ternary not being valid.
async function persistJob(job: Job) {
  await query(
    `INSERT INTO jobs (id, owner_email, kind, status, step, started_at, ended_at,
                       result, error, error_screenshot, log)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        step = EXCLUDED.step,
        ended_at = EXCLUDED.ended_at,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        error_screenshot = EXCLUDED.error_screenshot,
        log = EXCLUDED.log`,
    [
      job.id, job.ownerEmail, job.kind, job.status, job.step,
      job.startedAt,
      job.endedAt ? new Date(job.endedAt) : null,
      job.result ? JSON.stringify(job.result) : null,
      job.error, job.errorScreenshot, JSON.stringify(job.log),
    ],
  ).catch((e) => console.error('[jobs] persist error:', e?.message ?? e));
}

export function startAccountJob(opts: {
  ownerEmail: string;
  codexOAuthUrl?: string | null;
}): Job {
  const job: Job = {
    id: randomUUID(),
    kind: 'account',
    status: 'running',
    step: 'queued',
    startedAt: Date.now(),
    endedAt: null,
    result: null,
    error: null,
    errorScreenshot: null,
    ownerEmail: opts.ownerEmail,
    log: [],
  };
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  live.set(job.id, { job, cancel });
  void persistJob(job);

  const jobScreenshotDir = path.join(SCREENSHOTS_DIR, job.id);

  (async () => {
    try {
      const result = await createAccount({
        headless: process.env.HEADLESS !== 'false',
        codexOAuthUrl: opts.codexOAuthUrl ?? null,
        screenshotDir: jobScreenshotDir,
        onPageReady: (page: any) => {
          registerRemote(job.id, page);
          // Cooperative cancellation: if the request comes in mid-flow,
          // close the page to bail out fast.
          (page as any).__cancelHook__ = () => page.context().close().catch(() => {});
        },
        onProgress: (step: string, info: any) => {
          if (cancelled) {
            const p = getRemote(job.id);
            if (p && (p.page as any).__cancelHook__) (p.page as any).__cancelHook__();
            throw new Error('Cancelled by user');
          }
          job.step = step;
          job.log.push({ at: Date.now(), step, info });
          void persistJob({ ...job });
        },
      });
      job.status = 'done';
      job.step = 'done';
      job.result = result;
    } catch (e: any) {
      job.status = cancelled ? 'cancelled' : 'error';
      job.error = e?.message || String(e);
      if (e?.screenshotPath) {
        job.errorScreenshot = path.basename(e.screenshotPath);
      }
    } finally {
      job.endedAt = Date.now();
      unregisterRemote(job.id);
      live.delete(job.id);
      void persistJob(job);
    }
  })();

  return job;
}

export async function cancelJob(id: string, ownerEmail: string): Promise<boolean> {
  const entry = live.get(id);
  if (!entry || entry.job.ownerEmail !== ownerEmail) return false;
  entry.cancel();
  // Force the live page to close so the in-flight Playwright call rejects.
  const r = getRemote(id);
  if (r && (r.page as any).__cancelHook__) {
    (r.page as any).__cancelHook__();
  }
  return true;
}
