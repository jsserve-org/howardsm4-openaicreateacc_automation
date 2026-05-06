'use client';

import { createAuthClient } from 'better-auth/react';
import { genericOAuthClient } from 'better-auth/client/plugins';

const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});

export default function LoginPage() {
  const signIn = async () => {
    await authClient.signIn.oauth2({
      providerId: 'oidc',
      callbackURL: '/',
    });
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 360, padding: 32, border: '1px solid #2a2a2e', borderRadius: 12 }}>
        <h1 style={{ fontSize: 22, marginTop: 0 }}>Sign in</h1>
        <p style={{ color: '#9b9ba1', fontSize: 14 }}>
          Authentication is required to manage ChatGPT account creation jobs.
        </p>
        <button
          onClick={signIn}
          style={{
            display: 'block', width: '100%', padding: '10px 14px',
            background: '#3b82f6', color: 'white', border: 0,
            borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
          }}
        >
          Sign in with SSO
        </button>
      </div>
    </main>
  );
}
