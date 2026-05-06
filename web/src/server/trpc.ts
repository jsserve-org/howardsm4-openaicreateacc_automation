import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { auth } from './auth';
import { startAccountJob, listJobs, getJob } from './jobs';

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
