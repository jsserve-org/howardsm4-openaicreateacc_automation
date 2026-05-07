import { log, delay } from './helpers.js';

export class CloudflareEmailHandler {
  constructor(config = {}) {
    // Two backends, switched via env / config:
    //   - 'cf-worker' (default if CLOUDFLARE_WORKER_URL set): polls the worker
    //   - 'local-api' (preferred when MAIL_API_URL set): polls our own
    //     Postgres-backed endpoints fed by the IMAP poller
    this.backend =
      config.backend || (process.env.MAIL_API_URL ? 'local-api' : 'cf-worker');
    this.workerUrl = config.workerUrl || process.env.CLOUDFLARE_WORKER_URL;
    this.apiToken = config.apiToken || process.env.CLOUDFLARE_API_TOKEN;
    this.localApiUrl = config.localApiUrl || process.env.MAIL_API_URL;
    this.localApiToken = config.localApiToken || process.env.MAIL_API_TOKEN;
    this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    this.kvNamespaceId = config.kvNamespaceId || process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    this.domain = config.domain || process.env.EMAIL_DOMAIN;
  }

  baseUrl() {
    return this.backend === 'local-api' ? this.localApiUrl : this.workerUrl;
  }

  authHeaders() {
    const token = this.backend === 'local-api' ? this.localApiToken : this.apiToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  codeEndpoint(email) {
    if (this.backend === 'local-api') {
      return `${this.localApiUrl.replace(/\/$/, '')}/api/mail/code?email=${encodeURIComponent(email.toLowerCase())}`;
    }
    return `${this.workerUrl}/get-code?email=${encodeURIComponent(email.toLowerCase())}`;
  }

  emailsEndpoint(email) {
    if (this.backend === 'local-api') {
      return `${this.localApiUrl.replace(/\/$/, '')}/api/mail/list?email=${encodeURIComponent(email.toLowerCase())}`;
    }
    return `${this.workerUrl}/get-emails?email=${encodeURIComponent(email.toLowerCase())}`;
  }

  async getVerificationCode(email, options = {}) {
    const maxAttempts = options.maxAttempts || 30;
    const interval = options.interval || 3000;

    log(`Polling Cloudflare Worker for verification code for: ${email}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log(`Poll attempt ${attempt}/${maxAttempts}...`);

      try {
        const code = await this.fetchCodeFromWorker(email);
        if (code) {
          log(`Verification code found: ${code}`);
          return code;
        }
      } catch (e) {
        log(`Poll attempt ${attempt} failed: ${e.message}`, 'WARN');
      }

      await delay(interval);
    }

    throw new Error(`No verification code received for ${email} after ${maxAttempts} attempts`);
  }

  async fetchCodeFromWorker(email) {
    const response = await fetch(this.codeEndpoint(email), {
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Mail backend returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data.code || null;
  }

  async getEmails(email) {
    const response = await fetch(this.emailsEndpoint(email), {
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Mail backend returned ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async clearEmails(email) {
    const response = await fetch(`${this.workerUrl}/clear-emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: email.toLowerCase() }),
    });

    return response.ok;
  }

  async getVerificationCodeFromKV(email, options = {}) {
    const maxAttempts = options.maxAttempts || 30;
    const interval = options.interval || 3000;

    log(`Polling Cloudflare KV for verification code for: ${email}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log(`KV poll attempt ${attempt}/${maxAttempts}...`);

      try {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.kvNamespaceId}/values/${encodeURIComponent(email.toLowerCase())}`,
          {
            headers: {
              'Authorization': `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.code) {
            log(`Verification code found in KV: ${data.code}`);
            return data.code;
          }
        }
      } catch (e) {
        log(`KV poll attempt ${attempt} failed: ${e.message}`, 'WARN');
      }

      await delay(interval);
    }

    throw new Error(`No verification code in KV for ${email} after ${maxAttempts} attempts`);
  }
}
