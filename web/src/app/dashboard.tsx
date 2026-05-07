'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type Job = {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error' | string;
  step: string;
  startedAt: number;
  endedAt: number | null;
  result: any;
  error: string | null;
  errorScreenshot: string | null;
  log: { at: number; step: string; info: any }[];
};

export default function Dashboard({ userEmail }: { userEmail: string }) {
  const utils = trpc.useUtils();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 2000 });
  const startAccount = trpc.accounts.start.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });
  const linkCodex = trpc.codex.linkWithNewAccount.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const [oauthUrl, setOauthUrl] = useState('');
  const jobs: Job[] = (jobsQuery.data ?? []) as Job[];

  const stats = useMemo(() => {
    return {
      total: jobs.length,
      running: jobs.filter((j) => j.status === 'running').length,
      done: jobs.filter((j) => j.status === 'done').length,
      error: jobs.filter((j) => j.status === 'error').length,
    };
  }, [jobs]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header userEmail={userEmail} stats={stats} />

      <main className="flex-1 mx-auto w-full max-w-[1320px] px-6 lg:px-10 py-12 grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-x-12 gap-y-10">
        <aside className="space-y-10">
          <Hero stats={stats} />
          <DeployPanel
            oauthUrl={oauthUrl}
            setOauthUrl={setOauthUrl}
            startingAccount={startAccount.isPending}
            linkingCodex={linkCodex.isPending}
            onStartAccount={() => startAccount.mutate({})}
            onLinkCodex={() => linkCodex.mutate({ oauthUrl })}
          />
          <PolicyNotes />
        </aside>

        <section className="space-y-6 min-w-0">
          <SectionLabel
            left="Mission log"
            right={`${stats.total.toString().padStart(2, '0')} run${stats.total === 1 ? '' : 's'}`}
            sublabel="Newest first · polls every 2.0s"
          />
          <JobList jobs={jobs} loading={jobsQuery.isLoading} />
        </section>
      </main>

      <Footer />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */

function Header({ userEmail, stats }: { userEmail: string; stats: any }) {
  return (
    <header className="sticky top-0 z-20 border-b border-bg-hairline bg-bg/80 backdrop-blur-md">
      <div className="mx-auto max-w-[1320px] h-14 px-6 lg:px-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="text-[11px] tracking-[0.24em] uppercase text-ink-muted">
            acct.creator
          </span>
          <span className="text-[10px] tracking-[0.2em] uppercase text-ink-dim hidden sm:inline">
            console / 02
          </span>
        </div>
        <div className="flex items-center gap-6 text-[11px] tracking-[0.18em] uppercase">
          <span className="hidden md:flex items-center gap-2 text-accent-lime">
            <span className="blink-dot" />
            <span>{stats.running} active</span>
          </span>
          <span className="hidden md:inline text-ink-dim">·</span>
          <span className="text-ink truncate max-w-[220px]" title={userEmail}>
            {userEmail}
          </span>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-bg-hairline">
      <div className="mx-auto max-w-[1320px] px-6 lg:px-10 h-10 flex items-center justify-between text-[10px] tracking-[0.22em] uppercase text-ink-dim">
        <span>v 0.1.0 · ephemeral</span>
        <span>opus · playwright · cloudflare-mail</span>
      </div>
    </footer>
  );
}

/* ── HERO ─────────────────────────────────────────────────────────────── */

function Hero({ stats }: { stats: any }) {
  return (
    <div className="space-y-6">
      <p className="text-[11px] tracking-[0.32em] uppercase text-accent-lime">
        <span className="blink-dot" />
        Live operations
      </p>
      <h1 className="font-serif italic text-5xl lg:text-[64px] leading-[0.95] tracking-tightest text-balance">
        Mission&nbsp;<span className="text-ink-muted">control.</span>
      </h1>
      <p className="text-sm leading-relaxed text-ink-muted max-w-md">
        Provisions a fresh ChatGPT account end-to-end&nbsp;— signup, email verification,
        profile fill, onboarding skip. Optionally completes a Codex OAuth handoff
        in the same browser context.
      </p>

      <dl className="grid grid-cols-3 border-y border-bg-hairline divide-x divide-bg-hairline">
        <Stat k="running" v={stats.running} accent="lime" />
        <Stat k="done" v={stats.done} />
        <Stat k="errored" v={stats.error} accent={stats.error ? 'danger' : undefined} />
      </dl>
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: number; accent?: 'lime' | 'danger' }) {
  const accentCls =
    accent === 'lime' ? 'text-accent-lime'
      : accent === 'danger' ? 'text-accent-danger'
        : 'text-ink';
  return (
    <div className="px-4 py-3 first:pl-0">
      <div className={`text-2xl font-medium ${accentCls}`}>
        {v.toString().padStart(2, '0')}
      </div>
      <div className="text-[10px] tracking-[0.22em] uppercase text-ink-dim mt-1">{k}</div>
    </div>
  );
}

/* ── DEPLOY PANEL ─────────────────────────────────────────────────────── */

function DeployPanel({
  oauthUrl,
  setOauthUrl,
  startingAccount,
  linkingCodex,
  onStartAccount,
  onLinkCodex,
}: {
  oauthUrl: string;
  setOauthUrl: (v: string) => void;
  startingAccount: boolean;
  linkingCodex: boolean;
  onStartAccount: () => void;
  onLinkCodex: () => void;
}) {
  return (
    <div className="panel panel-corners">
      <span className="panel-label">// new&nbsp;deploy</span>
      <div className="p-6 space-y-6">
        <div className="space-y-3">
          <Label>01 · single account</Label>
          <p className="text-xs text-ink-muted leading-relaxed">
            Create one ChatGPT account. Returns the live session JSON when done.
          </p>
          <button
            onClick={onStartAccount}
            disabled={startingAccount}
            className="btn btn-primary w-full"
          >
            {startingAccount ? 'Dispatching…' : 'Create account →'}
          </button>
        </div>

        <Divider />

        <div className="space-y-3">
          <Label>02 · account + codex link</Label>
          <p className="text-xs text-ink-muted leading-relaxed">
            Paste the Codex CLI OAuth URL (the one with{' '}
            <code className="text-ink">redirect_uri=http://localhost:1455</code>) — we&apos;ll
            capture the callback for you.
          </p>
          <input
            value={oauthUrl}
            onChange={(e) => setOauthUrl(e.target.value)}
            placeholder="https://auth.openai.com/oauth/authorize?…"
            className="input"
            spellCheck={false}
          />
          <button
            onClick={onLinkCodex}
            disabled={!oauthUrl || linkingCodex}
            className="btn btn-ghost w-full"
          >
            {linkingCodex ? 'Dispatching…' : 'Create + link codex →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-[10px] tracking-[0.32em] uppercase text-ink-dim">
      <span className="flex-1 h-px bg-bg-hairline" />
      <span>or</span>
      <span className="flex-1 h-px bg-bg-hairline" />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] tracking-[0.28em] uppercase text-accent-lime">
      {children}
    </span>
  );
}

function PolicyNotes() {
  return (
    <ul className="text-[11px] leading-relaxed text-ink-dim space-y-2">
      <li>
        <span className="text-ink-muted">→</span>&nbsp; Sessions live in memory; restart wipes
        the log.
      </li>
      <li>
        <span className="text-ink-muted">→</span>&nbsp; Browser profiles are ephemeral
        (one per job, deleted on close).
      </li>
      <li>
        <span className="text-ink-muted">→</span>&nbsp; Output is sensitive — treat session
        JSON like a password.
      </li>
    </ul>
  );
}

/* ── MISSION LOG ──────────────────────────────────────────────────────── */

function SectionLabel({
  left,
  right,
  sublabel,
}: {
  left: string;
  right?: string;
  sublabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-bg-hairline pb-3">
      <div>
        <h2 className="font-serif italic text-3xl tracking-tightest">{left}</h2>
        {sublabel && (
          <p className="text-[10px] tracking-[0.22em] uppercase text-ink-dim mt-1">
            {sublabel}
          </p>
        )}
      </div>
      {right && (
        <span className="text-[11px] tracking-[0.22em] uppercase text-ink-muted">
          {right}
        </span>
      )}
    </div>
  );
}

function JobList({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  if (loading && jobs.length === 0) {
    return <Empty title="Loading manifest" sub="Reading jobs from console memory…" />;
  }
  if (jobs.length === 0) {
    return (
      <Empty
        title="No deploys yet"
        sub="Start one from the new&nbsp;deploy panel. Status will stream here."
      />
    );
  }
  return (
    <div className="border border-bg-hairline divide-y divide-bg-hairline">
      <ListHeaderRow />
      {jobs.map((job, i) => (
        <JobRow key={job.id} job={job} index={jobs.length - i} />
      ))}
    </div>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border border-dashed border-bg-hairline p-12 text-center">
      <div className="font-serif italic text-2xl text-ink">{title}</div>
      <p className="text-xs text-ink-muted mt-2" dangerouslySetInnerHTML={{ __html: sub }} />
    </div>
  );
}

function ListHeaderRow() {
  return (
    <div className="grid grid-cols-[3rem_5rem_1fr_minmax(8rem,11rem)_5rem] items-center gap-3 px-4 py-2 bg-bg-elev text-[10px] tracking-[0.2em] uppercase text-ink-dim">
      <span>#</span>
      <span>kind</span>
      <span>step</span>
      <span>id</span>
      <span className="text-right">age</span>
    </div>
  );
}

/* ── ROW ──────────────────────────────────────────────────────────────── */

function JobRow({ job, index }: { job: Job; index: number }) {
  // Auto-open running jobs so the operator can see remote control without
  // clicking; collapse-by-default for completed/errored.
  const [open, setOpen] = useState(job.status === 'running');
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full grid grid-cols-[3rem_5rem_1fr_minmax(8rem,11rem)_5rem] items-center gap-3 px-4 py-3 text-left
                    transition-colors hover:bg-bg-elev ${open ? 'bg-bg-elev' : ''}`}
      >
        <span className="text-[10px] tracking-[0.18em] uppercase text-ink-dim">
          {String(index).padStart(3, '0')}
        </span>
        <span className="flex items-center gap-2 text-xs">
          <StatusDot status={job.status} />
          <span className="text-ink">{job.kind}</span>
        </span>
        <span className="text-xs text-ink truncate">
          <StepText status={job.status} step={job.step} />
        </span>
        <code className="text-[11px] text-ink-muted truncate">{job.id}</code>
        <span className="text-[10px] tracking-[0.18em] uppercase text-ink-dim text-right">
          {age(job)}
        </span>
      </button>

      {open && (
        <div className="border-t border-bg-hairline animate-slide-up">
          <JobDetail job={job} />
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'done' ? 'text-accent-lime'
      : status === 'error' ? 'text-accent-danger'
        : 'text-accent-hazard';
  return (
    <span className={`relative inline-block w-2 h-2 ${color}`}>
      <span className="absolute inset-0 bg-current" />
      {status === 'running' && (
        <span className="absolute inset-0 bg-current animate-ping opacity-50" />
      )}
    </span>
  );
}

function StepText({ status, step }: { status: string; step: string }) {
  const cls =
    status === 'error' ? 'text-accent-danger'
      : status === 'done' ? 'text-accent-lime'
        : 'text-ink';
  return <span className={cls}>{prettyStep(step)}</span>;
}

function prettyStep(step: string) {
  return step.replace(/_/g, ' ');
}

function age(job: Job) {
  const ms = (job.endedAt ?? Date.now()) - job.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}`;
}

/* ── DETAIL ───────────────────────────────────────────────────────────── */

function JobDetail({ job }: { job: Job }) {
  return (
    <div className="grid lg:grid-cols-[1fr_minmax(280px,360px)] divide-y lg:divide-y-0 lg:divide-x divide-bg-hairline">
      <div className="p-6 space-y-6 min-w-0">
        {job.status === 'running' && <RemoteControl jobId={job.id} step={job.step} />}
        {job.error && (
          <ErrorBlock error={job.error} screenshot={job.errorScreenshot} jobId={job.id} />
        )}
        {job.result?.session && <SessionReveal session={job.result.session} />}
        {job.result?.codexCallbackUrl && (
          <KeyValue
            k="codex callback url"
            v={job.result.codexCallbackUrl}
            mono
            copyable
            tone="lime"
          />
        )}
        {job.result?.email && (
          <KeyValue k="account email" v={job.result.email} mono copyable />
        )}
        <Inbox jobId={job.id} active={job.status === 'running'} />
      </div>

      <div className="p-6">
        <ProgressLog log={job.log} status={job.status} />
      </div>
    </div>
  );
}

/* ── INBOX (Cloudflare worker view of received emails) ──────────────── */

function Inbox({ jobId, active }: { jobId: string; active: boolean }) {
  const inbox = trpc.jobs.inbox.useQuery(
    { id: jobId },
    { refetchInterval: active ? 4000 : false },
  );
  const data = inbox.data as
    | { email: string | null; messages: any[]; error?: string }
    | undefined;

  if (!data?.email) return null;
  const messages = data.messages ?? [];

  return (
    <div className="border border-bg-hairline">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-hairline bg-bg-elev">
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.24em] uppercase text-ink-dim">
            inbox · cloudflare worker
          </span>
          <code className="text-[10px] text-ink-muted truncate">{data.email}</code>
        </div>
        <span className="text-[10px] tracking-[0.18em] uppercase text-ink-dim">
          {messages.length} msg{messages.length === 1 ? '' : 's'}
          {active && <span className="ml-2 text-accent-lime blink-dot align-middle" />}
        </span>
      </div>

      {data.error && (
        <div className="px-3 py-2 text-[11px] text-accent-danger bg-accent-danger/[0.04]">
          {data.error}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="px-3 py-4 text-[11px] text-ink-dim italic">
          No mail yet. Worker will record incoming messages here as they arrive.
        </div>
      ) : (
        <ul className="divide-y divide-bg-hairline">
          {messages.map((m, i) => (
            <InboxRow key={i} msg={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({ msg }: { msg: any }) {
  const [open, setOpen] = useState(false);
  const time = msg.receivedAt ? new Date(msg.receivedAt).toLocaleTimeString('en-GB', { hour12: false }) : '—';
  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full grid grid-cols-[5rem_1fr_auto] items-center gap-3 px-3 py-2 text-left text-[11px] hover:bg-bg-elev"
      >
        <code className="text-ink-dim">{time}</code>
        <span className="text-ink truncate">
          <span className="text-ink-muted">{msg.from}</span>
          {msg.subject && <span className="ml-2">{msg.subject}</span>}
        </span>
        {msg.code && (
          <span className="px-2 py-0.5 bg-accent-hazard/10 text-accent-hazard font-medium tracking-wider">
            {msg.code}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 animate-fade-in">
          <div className="grid grid-cols-2 gap-2 text-[10px] tracking-[0.18em] uppercase text-ink-dim">
            <Field k="to" v={msg.to} />
            <Field k="from" v={msg.from} />
            <Field k="subject" v={msg.subject} />
            <Field k="code" v={msg.code ?? '(none extracted)'} />
          </div>
          <pre className="p-2 bg-bg-panel border border-bg-hairline text-[10px] text-ink-muted overflow-auto max-h-64 whitespace-pre-wrap break-all scrollbar-hairline">
            {msg.body}
          </pre>
        </div>
      )}
    </li>
  );
}

function Field({ k, v }: { k: string; v: any }) {
  return (
    <div className="truncate">
      <span className="text-ink-dim">{k}:</span>{' '}
      <span className="text-ink-muted normal-case">{String(v ?? '')}</span>
    </div>
  );
}

/* ── REMOTE CONTROL ───────────────────────────────────────────────────── */
//
// Live screenshot of the headless browser + click/key forwarding through
// tRPC. Used to bypass interstitials like Cloudflare Turnstile that the
// AI agent can't solve on its own.

function RemoteControl({ jobId, step }: { jobId: string; step: string }) {
  const viewport = trpc.jobs.viewport.useQuery(
    { id: jobId },
    { refetchInterval: 800, refetchIntervalInBackground: true },
  );
  const click = trpc.jobs.click.useMutation();
  const key = trpc.jobs.key.useMutation();
  const type = trpc.jobs.type.useMutation();
  const [text, setText] = useState('');

  const data = viewport.data as
    | { png: string; url: string; width: number; height: number }
    | null
    | undefined;
  const needsHuman = step === 'awaiting_human';

  const onImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!data) return;
    const rect = (e.target as HTMLImageElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * data.width;
    const y = ((e.clientY - rect.top) / rect.height) * data.height;
    click.mutate({ id: jobId, x, y });
  };

  const sendType = () => {
    if (!text) return;
    type.mutate({ id: jobId, text });
    setText('');
  };

  return (
    <div className={`relative border ${needsHuman ? 'border-accent-hazard/60' : 'border-bg-hairlineHi'} bg-bg-elev`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-hairline">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 ${needsHuman ? 'text-accent-hazard' : 'text-accent-lime'}`}>
            <span className="inline-block w-full h-full bg-current animate-ping opacity-60" />
          </span>
          <span className="text-[10px] tracking-[0.24em] uppercase text-ink-muted">
            {needsHuman ? 'human assist requested' : 'remote control'}
          </span>
        </div>
        <code className="text-[10px] text-ink-dim truncate max-w-[60%]">
          {data?.url ?? 'connecting…'}
        </code>
      </div>

      {needsHuman && (
        <div className="px-3 py-2 text-[11px] text-accent-hazard bg-accent-hazard/[0.06] border-b border-bg-hairline">
          Cloudflare challenge detected — click the &ldquo;Verify you are human&rdquo;
          checkbox below. The flow resumes automatically once the page advances.
        </div>
      )}

      <div className="bg-bg p-3">
        {data ? (
          <img
            src={`data:image/png;base64,${data.png}`}
            alt="remote viewport"
            onClick={onImgClick}
            className="w-full block cursor-crosshair select-none border border-bg-hairline"
            draggable={false}
          />
        ) : (
          <div className="aspect-video w-full grid place-items-center text-[10px] tracking-[0.24em] uppercase text-ink-dim border border-dashed border-bg-hairline">
            attaching to browser…
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] tracking-[0.18em] uppercase">
          <span className="text-ink-dim">keys</span>
          {(['Enter', 'Tab', 'Backspace', 'Escape'] as const).map((k) => (
            <button
              key={k}
              onClick={() => key.mutate({ id: jobId, key: k })}
              className="btn btn-ghost !h-7 !px-2 !text-[10px]"
            >
              {k.toLowerCase()}
            </button>
          ))}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                sendType();
              }
            }}
            placeholder="type into focused field…"
            className="input !h-7 !text-[11px] flex-1 min-w-[120px]"
          />
          <button onClick={sendType} className="btn btn-ghost !h-7 !px-3 !text-[10px]">
            send
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressLog({ log, status }: { log: Job['log']; status: string }) {
  // Surface high-signal fields from `info` inline so the operator can see
  // (and grab) the email / OTP code without opening anything else.
  const captured = useMemo(() => {
    let email: string | undefined;
    let code: string | undefined;
    for (const l of log) {
      if (l.info?.email && !email) email = l.info.email;
      if (l.info?.code && !code) code = l.info.code;
    }
    return { email, code };
  }, [log]);

  return (
    <div className="space-y-4">
      {(captured.email || captured.code) && (
        <div className="border border-bg-hairline divide-y divide-bg-hairline text-[11px]">
          {captured.email && (
            <CapturedField label="email" value={captured.email} />
          )}
          {captured.code && (
            <CapturedField label="otp code" value={captured.code} tone="hazard" />
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] tracking-[0.24em] uppercase text-ink-dim">
            event log
          </span>
          <span className="text-[10px] tracking-[0.18em] uppercase text-ink-dim">
            {log.length} step{log.length === 1 ? '' : 's'}
          </span>
        </div>
        <ol className="space-y-1.5 text-[11px]">
          {log.map((l, i) => {
            const isLast = i === log.length - 1;
            const dotColor =
              status === 'error' && isLast ? 'text-accent-danger'
                : status === 'done' && isLast ? 'text-accent-lime'
                  : isLast ? 'text-accent-hazard'
                    : 'text-ink-dim';
            return (
              <li key={i} className="grid grid-cols-[5.5rem_1rem_1fr] gap-2 items-start">
                <code className="text-ink-dim">
                  {new Date(l.at).toLocaleTimeString('en-GB', { hour12: false })}
                </code>
                <span className={`mt-1 inline-block w-1.5 h-1.5 ${dotColor}`}>
                  <span className="inline-block w-full h-full bg-current" />
                </span>
                <div className="min-w-0">
                  <div className="text-ink truncate">{prettyStep(l.step)}</div>
                  <InfoDetails info={l.info} />
                </div>
              </li>
            );
          })}
          {status === 'running' && (
            <li className="grid grid-cols-[5.5rem_1rem_1fr] gap-2 items-start text-ink-muted">
              <code>—</code>
              <span className="mt-1 inline-block w-1.5 h-1.5 text-accent-hazard">
                <span className="inline-block w-full h-full bg-current animate-ping" />
              </span>
              <span className="italic">awaiting next event…</span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}

function CapturedField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'hazard';
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const valueCls =
    tone === 'hazard' ? 'text-accent-hazard font-medium' : 'text-ink';
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="text-[10px] tracking-[0.24em] uppercase text-ink-dim shrink-0">
          {label}
        </span>
        <code className={`truncate ${valueCls}`}>{value}</code>
      </div>
      <button
        onClick={copy}
        className="text-[10px] tracking-[0.18em] uppercase text-ink-muted hover:text-accent-lime shrink-0"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

function InfoDetails({ info }: { info: any }) {
  if (!info) return null;
  // Skip noise: the per-step `email` repetition is shown in the captured
  // fields above; we only highlight novel fields here.
  const entries = Object.entries(info).filter(
    ([k, v]) => v != null && v !== '' && k !== 'email',
  );
  if (entries.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5 text-[10px] text-ink-muted">
      {entries.map(([k, v]) => (
        <li key={k} className="truncate">
          <span className="text-ink-dim">{k}:</span>{' '}
          <code className="text-ink-muted">{String(v)}</code>
        </li>
      ))}
    </ul>
  );
}

function KeyValue({
  k,
  v,
  mono,
  copyable,
  tone,
}: {
  k: string;
  v: string;
  mono?: boolean;
  copyable?: boolean;
  tone?: 'lime' | 'danger';
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(v);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const valueCls = tone === 'lime' ? 'text-accent-lime' : tone === 'danger' ? 'text-accent-danger' : 'text-ink';
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-[0.24em] uppercase text-ink-dim">{k}</span>
        {copyable && (
          <button onClick={copy} className="text-[10px] tracking-[0.18em] uppercase text-ink-muted hover:text-accent-lime">
            {copied ? 'copied' : 'copy'}
          </button>
        )}
      </div>
      <div
        className={`px-3 py-2 border border-bg-hairline bg-bg-elev text-xs break-all ${mono ? 'font-mono' : ''} ${valueCls}`}
      >
        {v}
      </div>
    </div>
  );
}

/* ── ERROR ────────────────────────────────────────────────────────────── */

function ErrorBlock({
  error,
  screenshot,
  jobId,
}: {
  error: string;
  screenshot: string | null;
  jobId: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] tracking-[0.24em] uppercase text-accent-danger">
        <span className="inline-block w-2 h-2 bg-current" />
        error
      </div>
      <pre className="p-3 border border-accent-danger/40 bg-accent-danger/[0.04] text-xs whitespace-pre-wrap text-ink break-all">
        {error}
      </pre>
      {screenshot && (
        <div className="space-y-2">
          <span className="text-[10px] tracking-[0.24em] uppercase text-ink-dim">
            captured page
          </span>
          <a
            href={`/api/screenshot/${jobId}/${screenshot}`}
            target="_blank"
            rel="noopener"
            className="block border border-bg-hairline overflow-hidden hover:border-ink-muted transition-colors"
          >
            <img
              src={`/api/screenshot/${jobId}/${screenshot}`}
              alt="error"
              className="w-full"
            />
          </a>
        </div>
      )}
    </div>
  );
}

/* ── SESSION REVEAL ───────────────────────────────────────────────────── */
//
// The session JSON is the ChatGPT auth blob — sharing it grants account
// access. Treat it like radioactive material: hazard tape, blur until
// REVEAL, prominent warning banner, copy-and-burn affordance.

function SessionReveal({ session }: { session: any }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => JSON.stringify(session, null, 2), [session]);

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="hazard-frame">
      <div className="bg-bg p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="hazard-tape inline-block w-3 h-3" />
            <span className="text-[10px] tracking-[0.28em] uppercase text-accent-hazard">
              sensitive output / do not share
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] tracking-[0.18em] uppercase">
            <button
              onClick={() => setRevealed((r) => !r)}
              className="text-ink-muted hover:text-accent-hazard"
            >
              {revealed ? 'conceal' : 'reveal'}
            </button>
            <span className="text-ink-dim">·</span>
            <button onClick={copy} className="text-ink-muted hover:text-accent-lime">
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-ink-muted">
          This is the live{' '}
          <code className="text-ink">chatgpt.com/api/auth/session</code> response for
          the just-provisioned account. Possession of this blob is equivalent to
          having the password.
        </p>

        <div
          className={`relative border border-bg-hairlineHi bg-bg-panel transition-[filter,opacity] duration-300 ${
            revealed ? '' : 'blur-[6px] opacity-80 select-none pointer-events-none'
          }`}
        >
          <pre className="p-3 text-[11px] leading-relaxed text-ink overflow-auto max-h-[420px] scrollbar-hairline">
            {json}
          </pre>
        </div>

        {!revealed && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              onClick={() => setRevealed(true)}
              className="btn btn-primary pointer-events-auto"
            >
              Reveal session →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── MARK ─────────────────────────────────────────────────────────────── */

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="text-accent-lime">
      <rect x="0.5" y="0.5" width="21" height="21" stroke="currentColor" fill="none" />
      <path d="M5.5 16L11 6l5.5 10M7.5 13h7" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}
