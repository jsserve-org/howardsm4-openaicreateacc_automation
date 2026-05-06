'use client';

import { createAuthClient } from 'better-auth/react';
import { genericOAuthClient } from 'better-auth/client/plugins';
import { useState } from 'react';

const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});

export default function LoginPage() {
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      await authClient.signIn.oauth2({ providerId: 'oidc', callbackURL: '/' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      {/* Top hairline — empty bar, gives the page architecture. */}
      <div className="border-b border-bg-hairline">
        <div className="mx-auto max-w-[1280px] px-6 lg:px-10 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mark />
            <span className="text-[11px] tracking-[0.24em] uppercase text-ink-muted">
              acct.creator
            </span>
          </div>
          <span className="text-[11px] tracking-[0.2em] uppercase text-ink-dim">
            console / restricted
          </span>
        </div>
      </div>

      {/* Hero. Off-center on desktop, calm on mobile. */}
      <div className="flex-1 grid lg:grid-cols-12 gap-0">
        <section className="lg:col-span-7 lg:col-start-2 flex items-center px-6 lg:px-10 py-20">
          <div className="max-w-2xl space-y-10 animate-fade-in">
            <p className="text-[11px] tracking-[0.32em] uppercase text-accent-lime">
              <span className="blink-dot" />
              Authentication required
            </p>

            <h1 className="font-serif italic text-6xl md:text-7xl lg:text-[88px] leading-[0.95] tracking-tightest text-balance">
              The console is&nbsp;
              <span className="text-ink-muted">behind</span>
              <br />
              one&nbsp;door.
            </h1>

            <p className="max-w-md text-sm leading-relaxed text-ink-muted">
              Single sign-on via your organization&apos;s OIDC provider. After authentication
              you&apos;ll land on the operations dashboard, where you can provision new
              ChatGPT accounts and link them to a Codex CLI flow.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <button
                onClick={signIn}
                disabled={busy}
                className="btn btn-primary !h-12 !px-6 group"
              >
                <span>{busy ? 'Routing…' : 'Sign in with SSO'}</span>
                <Arrow />
              </button>
              <span className="text-[11px] tracking-[0.2em] uppercase text-ink-dim">
                provider · oidc / generic
              </span>
            </div>
          </div>
        </section>

        {/* Architecture column — a tiny system manifest. Decorative, but real data. */}
        <aside className="hidden lg:flex lg:col-span-3 lg:col-start-10 border-l border-bg-hairline bg-bg-panel">
          <dl className="self-end p-10 w-full text-[11px] tracking-[0.18em] uppercase text-ink-muted space-y-4">
            <ManifestRow k="route" v="/api/auth/sign-in/oauth2" />
            <ManifestRow k="callback" v="/api/auth/oauth2/callback/oidc" />
            <ManifestRow k="scopes" v="openid · profile · email" />
            <ManifestRow k="sessions" v="memory" />
            <ManifestRow k="surface" v="01 / 02" />
          </dl>
        </aside>
      </div>

      <footer className="border-t border-bg-hairline">
        <div className="mx-auto max-w-[1280px] px-6 lg:px-10 h-10 flex items-center justify-between text-[10px] tracking-[0.22em] uppercase text-ink-dim">
          <span>v 0.1.0</span>
          <span>opus / playwright / cloudflare</span>
        </div>
      </footer>
    </main>
  );
}

function ManifestRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-bg-hairline pb-2">
      <dt className="text-ink-dim">{k}</dt>
      <dd className="text-ink truncate">{v}</dd>
    </div>
  );
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="text-accent-lime">
      <rect x="0.5" y="0.5" width="21" height="21" stroke="currentColor" fill="none" />
      <path d="M5.5 16L11 6l5.5 10M7.5 13h7" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" className="transition-transform group-hover:translate-x-1">
      <path d="M0 5h14M10 1l4 4-4 4" stroke="currentColor" fill="none" />
    </svg>
  );
}
