import { log, delay } from './helpers.js';

export class CloudflareEmailHandler {
  constructor(config = {}) {
    this.workerUrl = config.workerUrl || process.env.CLOUDFLARE_WORKER_URL;
    this.apiToken = config.apiToken || process.env.CLOUDFLARE_API_TOKEN;
    this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
    this.kvNamespaceId = config.kvNamespaceId || process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    this.domain = config.domain || process.env.EMAIL_DOMAIN;
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
    const response = await fetch(`${this.workerUrl}/get-code?email=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Worker returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data.code || null;
  }

  async getEmails(email) {
    const response = await fetch(`${this.workerUrl}/get-emails?email=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}: ${await response.text()}`);
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
      body: JSON.stringify({ email }),
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
          `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.kvNamespaceId}/values/${encodeURIComponent(email)}`,
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
