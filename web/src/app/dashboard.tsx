'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function Dashboard({ userEmail }: { userEmail: string }) {
  const utils = trpc.useUtils();
  const jobs = trpc.jobs.list.useQuery(undefined, { refetchInterval: 2000 });
  const startAccount = trpc.accounts.start.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });
  const linkCodex = trpc.codex.linkWithNewAccount.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const [oauthUrl, setOauthUrl] = useState('');

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>ChatGPT Account Creator</h1>
        <span style={{ color: '#9b9ba1', fontSize: 13 }}>{userEmail}</span>
      </header>

      <section style={panelStyle}>
        <h2 style={h2Style}>New job</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            disabled={startAccount.isPending}
            onClick={() => startAccount.mutate({})}
            style={primaryBtn}
          >
            {startAccount.isPending ? 'Starting…' : 'Create account'}
          </button>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, color: '#9b9ba1', marginBottom: 6 }}>
            Codex OAuth URL (optional — links Codex CLI to the new account)
          </label>
          <input
            value={oauthUrl}
            onChange={(e) => setOauthUrl(e.target.value)}
            placeholder="https://auth.openai.com/oauth/authorize?client_id=…"
            style={inputStyle}
          />
          <button
            disabled={!oauthUrl || linkCodex.isPending}
            onClick={() => linkCodex.mutate({ oauthUrl })}
            style={{ ...primaryBtn, marginTop: 8 }}
          >
            {linkCodex.isPending ? 'Starting…' : 'Create account + link Codex'}
          </button>
        </div>
      </section>

      <section style={panelStyle}>
        <h2 style={h2Style}>Jobs</h2>
        {(jobs.data ?? []).length === 0 ? (
          <p style={{ color: '#9b9ba1', fontSize: 14 }}>No jobs yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {jobs.data?.map((j: any) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function JobRow({ job }: { job: any }) {
  const [open, setOpen] = useState(false);
  const dot = job.status === 'done' ? '#22c55e' : job.status === 'error' ? '#ef4444' : '#eab308';
  return (
    <div style={{ border: '1px solid #2a2a2e', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: dot, marginRight: 8 }} />
          <strong>{job.kind}</strong> — <span style={{ color: '#9b9ba1' }}>{job.step}</span>
        </div>
        <code style={{ fontSize: 12, color: '#9b9ba1' }}>{job.id.slice(0, 8)}</code>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {job.status === 'done' && job.result?.session && (
            <>
              <h4 style={{ margin: '6px 0' }}>Session JSON</h4>
              <pre style={preStyle}>{JSON.stringify(job.result.session, null, 2)}</pre>
            </>
          )}
          {job.status === 'done' && job.result?.codexCallbackUrl && (
            <>
              <h4 style={{ margin: '6px 0' }}>Codex callback URL</h4>
              <pre style={preStyle}>{job.result.codexCallbackUrl}</pre>
            </>
          )}
          {job.error && (
            <>
              <h4 style={{ margin: '6px 0', color: '#ef4444' }}>Error</h4>
              <pre style={preStyle}>{job.error}</pre>
            </>
          )}
          <h4 style={{ margin: '6px 0' }}>Progress</h4>
          <pre style={preStyle}>
            {job.log?.map((l: any) => `[${new Date(l.at).toISOString()}] ${l.step}`).join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: '1px solid #2a2a2e', borderRadius: 12, padding: 16, marginBottom: 16,
};
const h2Style: React.CSSProperties = { fontSize: 16, marginTop: 0 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: '#16161a',
  border: '1px solid #2a2a2e', color: 'inherit', borderRadius: 6, fontSize: 13,
};
const primaryBtn: React.CSSProperties = {
  background: '#3b82f6', color: 'white', border: 0, padding: '8px 14px',
  borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600,
};
const preStyle: React.CSSProperties = {
  background: '#16161a', padding: 10, borderRadius: 6, fontSize: 12,
  overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};
