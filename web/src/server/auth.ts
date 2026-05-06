import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';

let cached: any = null;

function build() {
  const required = (key: string) => {
    const v = process.env[key];
    if (!v) throw new Error(`Missing env: ${key}`);
    return v;
  };

  const enableDevPasswordAuth = process.env.DEV_PASSWORD_AUTH === 'true';
  const enableOidc = !!process.env.OIDC_DISCOVERY_URL;

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    secret: process.env.BETTER_AUTH_SECRET || 'dev-insecure-secret-change-me',
    emailAndPassword: { enabled: enableDevPasswordAuth },
    plugins: enableOidc
      ? [
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
        ]
      : [],
  });
}

// Use a callable Proxy so that both `auth.handler(req)` and `auth(req)` work,
// and `"handler" in auth` correctly resolves to true once initialized.
export const auth: any = new Proxy(function () {}, {
  get(_t, prop) {
    if (!cached) cached = build();
    return cached[prop];
  },
  has(_t, prop) {
    if (!cached) cached = build();
    return prop in cached;
  },
  apply(_t, _thisArg, args) {
    if (!cached) cached = build();
    return cached.handler(...(args as [any]));
  },
});
