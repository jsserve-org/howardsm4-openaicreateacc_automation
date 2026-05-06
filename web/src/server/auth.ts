import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';

let cached: any = null;

function build() {
  const required = (key: string) => {
    const v = process.env[key];
    if (!v) throw new Error(`Missing env: ${key}`);
    return v;
  };

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    secret: process.env.BETTER_AUTH_SECRET || 'dev-insecure-secret-change-me',
    emailAndPassword: { enabled: false },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: 'oidc',
            clientId: required('OIDC_CLIENT_ID'),
            clientSecret: required('OIDC_CLIENT_SECRET'),
            discoveryUrl: required('OIDC_DISCOVERY_URL'),
            scopes: (process.env.OIDC_SCOPES || 'openid profile email').split(/\s+/),
          },
        ],
      }),
    ],
  });
}

// Lazy proxy: defer env validation until the first request rather than at
// module load (which would break `next build`).
export const auth: any = new Proxy({} as any, {
  get(_t, prop) {
    if (!cached) cached = build();
    return cached[prop];
  },
});
