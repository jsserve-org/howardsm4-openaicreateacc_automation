import { randomUUID } from 'crypto';
import path from 'path';
import { createAccount } from '../../../src/lib/account-creator.js';

const REPO_ROOT = path.resolve(process.cwd(), '..');
const SCREENSHOTS_DIR = path.join(REPO_ROOT, 'screenshots', 'web-jobs');

export type JobStatus = 'running' | 'done' | 'error';

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

const jobs = new Map<string, Job>();

export function listJobs(ownerEmail: string): Job[] {
  return [...jobs.values()]
    .filter((j) => j.ownerEmail === ownerEmail)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function getJob(id: string, ownerEmail: string): Job | null {
  const j = jobs.get(id);
  if (!j || j.ownerEmail !== ownerEmail) return null;
  return j;
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
  jobs.set(job.id, job);

  const jobScreenshotDir = path.join(SCREENSHOTS_DIR, job.id);

  // Fire and forget; the in-memory job mutates as the flow advances.
  (async () => {
    try {
      const result = await createAccount({
        headless: process.env.HEADLESS !== 'false',
        codexOAuthUrl: opts.codexOAuthUrl ?? null,
        screenshotDir: jobScreenshotDir,
        onProgress: (step: string, info: any) => {
          job.step = step;
          job.log.push({ at: Date.now(), step, info });
        },
      });
      job.status = 'done';
      job.step = 'done';
      job.result = result;
    } catch (e: any) {
      job.status = 'error';
      job.error = e?.message || String(e);
      if (e?.screenshotPath) {
        job.errorScreenshot = path.basename(e.screenshotPath);
      }
    } finally {
      job.endedAt = Date.now();
    }
  })();

  return job;
}
