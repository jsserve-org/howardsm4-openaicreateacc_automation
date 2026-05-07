import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auth } from './auth';
import { startAccountJob, listJobs, getJob } from './jobs';
import { snapshot, click, pressKey, typeText } from './remote';
import { CloudflareEmailHandler } from '../../../src/utils/email-handler.js';

export type Context = {
  userEmail: string | null;
};

export async function createContext(opts: { headers: Headers }): Promise<Context> {
  const session = await auth.api.getSession({ headers: opts.headers });
  return { userEmail: session?.user?.email ?? null };
}

const t = initTRPC.context<Context>().create();

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userEmail) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { userEmail: ctx.userEmail } });
});

export const appRouter = t.router({
  jobs: t.router({
    list: protectedProcedure.query(({ ctx }) => listJobs(ctx.userEmail)),
    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(({ ctx, input }) => {
        const j = getJob(input.id, ctx.userEmail);
        if (!j) throw new TRPCError({ code: 'NOT_FOUND' });
        return j;
      }),
    // Remote-control surface — only succeeds for jobs the caller owns.
    viewport: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        if (!getJob(input.id, ctx.userEmail)) throw new TRPCError({ code: 'NOT_FOUND' });
        return snapshot(input.id);
      }),
    click: protectedProcedure
      .input(z.object({ id: z.string().uuid(), x: z.number(), y: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!getJob(input.id, ctx.userEmail)) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: await click(input.id, input.x, input.y) };
      }),
    key: protectedProcedure
      .input(z.object({ id: z.string().uuid(), key: z.string().min(1).max(20) }))
      .mutation(async ({ ctx, input }) => {
        if (!getJob(input.id, ctx.userEmail)) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: await pressKey(input.id, input.key) };
      }),
    type: protectedProcedure
      .input(z.object({ id: z.string().uuid(), text: z.string().max(500) }))
      .mutation(async ({ ctx, input }) => {
        if (!getJob(input.id, ctx.userEmail)) throw new TRPCError({ code: 'NOT_FOUND' });
        return { ok: await typeText(input.id, input.text) };
      }),
    // Forward the Cloudflare worker inbox for this job's burner email so
    // the operator can see every received message + extracted code.
    inbox: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const job = getJob(input.id, ctx.userEmail);
        if (!job) throw new TRPCError({ code: 'NOT_FOUND' });
        const email =
          (job.result as any)?.email ??
          job.log.find((l) => l.info?.email)?.info?.email ??
          null;
        if (!email) return { email: null, messages: [] as any[] };
        try {
          const messages = await new CloudflareEmailHandler().getEmails(email);
          return { email, messages };
        } catch (e: any) {
          return { email, messages: [], error: e?.message ?? String(e) };
        }
      }),
  }),
  accounts: t.router({
    start: protectedProcedure
      .input(
        z
          .object({ codexOAuthUrl: z.string().url().nullable().optional() })
          .default({}),
      )
      .mutation(({ ctx, input }) =>
        startAccountJob({
          ownerEmail: ctx.userEmail,
          codexOAuthUrl: input.codexOAuthUrl ?? null,
        }),
      ),
  }),
  codex: t.router({
    // Convenience: start a job that creates an account AND links a Codex OAuth
    // URL in one shot. (Standalone Codex linking against an existing account
    // is not supported in this MVP — pair it with creation.)
    linkWithNewAccount: protectedProcedure
      .input(z.object({ oauthUrl: z.string().url() }))
      .mutation(({ ctx, input }) =>
        startAccountJob({
          ownerEmail: ctx.userEmail,
          codexOAuthUrl: input.oauthUrl,
        }),
      ),
  }),
});

export type AppRouter = typeof appRouter;
