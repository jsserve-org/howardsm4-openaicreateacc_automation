import { log, delay } from './helpers.js';

const TWOCAPTCHA_API = 'https://2captcha.com';

export class CaptchaSolver {
  constructor(config = {}) {
    this.provider = config.provider || process.env.CAPTCHA_PROVIDER || '2captcha';
    this.apiKey = config.apiKey || process.env.CAPTCHA_API_KEY;
    this.pollInterval = config.pollInterval || 5000;
    this.maxPollTime = config.maxPollTime || 180000;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async solveTurnstile(sitekey, pageUrl, options = {}) {
    if (!this.isConfigured()) throw new Error('CAPTCHA_API_KEY not configured');

    log(`Solving Cloudflare Turnstile: sitekey=${sitekey}`);
    const taskId = await this.createTask('TurnstileTaskProxyless', {
      websiteURL: pageUrl,
      websiteKey: sitekey,
      action: options.action || 'verify',
    });

    return this.pollForResult(taskId);
  }

  async solveHCaptcha(sitekey, pageUrl) {
    if (!this.isConfigured()) throw new Error('CAPTCHA_API_KEY not configured');

    log(`Solving hCaptcha: sitekey=${sitekey}`);
    const taskId = await this.createTask('HCaptchaTaskProxyless', {
      websiteURL: pageUrl,
      websiteKey: sitekey,
    });

    return this.pollForResult(taskId);
  }

  async createTask(type, taskData) {
    const response = await fetch(`${TWOCAPTCHA_API}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: this.apiKey,
        task: { type, ...taskData },
      }),
    });

    const result = await response.json();
    if (result.errorId !== 0) {
      throw new Error(`2Captcha createTask error: ${result.errorDescription}`);
    }

    log(`Task created: ${result.taskId}`);
    return result.taskId;
  }

  async pollForResult(taskId) {
    const startTime = Date.now();

    while (Date.now() - startTime < this.maxPollTime) {
      const response = await fetch(`${TWOCAPTCHA_API}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: this.apiKey,
          taskId,
        }),
      });

      const result = await response.json();

      if (result.status === 'ready') {
        log('CAPTCHA solved successfully');
        return result.solution;
      }

      if (result.errorId !== 0) {
        throw new Error(`2Captcha error: ${result.errorDescription}`);
      }

      log(`CAPTCHA solving in progress... (${Math.round((Date.now() - startTime) / 1000)}s)`);
      await delay(this.pollInterval);
    }

    throw new Error('CAPTCHA solving timed out');
  }

  async detectAndSolve(page) {
    const url = page.url();
    const frames = page.frames();

    for (const frame of frames) {
      const frameUrl = frame.url();

      if (frameUrl.includes('challenges.cloudflare.com') && frameUrl.includes('turnstile')) {
        log('Cloudflare Turnstile detected via frame URL');
        const sitekeyMatch = frameUrl.match(/(0x[a-zA-Z0-9]+)/);
        if (sitekeyMatch) {
          const sitekey = sitekeyMatch[0];
          log(`Turnstile sitekey: ${sitekey}`);
          try {
            const solution = await this.solveTurnstile(sitekey, url);
            await this.injectTurnstileSolution(page, solution);
            return { type: 'turnstile', solved: true };
          } catch (e) {
            log(`Turnstile solve failed: ${e.message}`, 'ERROR');
            return { type: 'turnstile', solved: false, error: e.message };
          }
        }
      }

      if (frameUrl.includes('hcaptcha.com')) {
        log('hCaptcha detected via frame URL');
        const sitekeyMatch = frameUrl.match(/sitekey=([^&]+)/);
        if (sitekeyMatch) {
          try {
            const solution = await this.solveHCaptcha(sitekeyMatch[1], url);
            await this.injectHCaptchaSolution(page, solution);
            return { type: 'hcaptcha', solved: true };
          } catch (e) {
            log(`hCaptcha solve failed: ${e.message}`, 'ERROR');
            return { type: 'hcaptcha', solved: false, error: e.message };
          }
        }
      }

      if (frameUrl.includes('google.com/recaptcha')) {
        log('reCAPTCHA detected via frame URL');
        const sitekeyMatch = frameUrl.match(/k=([^&]+)/);
        if (sitekeyMatch) {
          log(`reCAPTCHA sitekey: ${sitekeyMatch[1]}`);
          return { type: 'recaptcha', solved: false, note: 'reCAPTCHA solving not implemented' };
        }
      }
    }

    log('No known CAPTCHA detected');
    return { type: 'none', solved: false };
  }

  async injectTurnstileSolution(page, solution) {
    const token = solution.gRecaptchaResponse || solution.token;
    log('Injecting Turnstile token...');

    await page.evaluate((token) => {
      const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
      inputs.forEach(input => input.value = token);

      const responseInput = document.querySelector('[name="cf-turnstile-response"]');
      if (responseInput) responseInput.value = token;

      if (window.turnstile) {
        try { window.turnstile.execute(); } catch(e) {}
      }
    }, token);

    await delay(1000);
  }

  async injectHCaptchaSolution(page, solution) {
    const token = solution.gRecaptchaResponse;
    log('Injecting hCaptcha token...');

    await page.evaluate((token) => {
      const textarea = document.querySelector('textarea[name="h-captcha-response"]');
      if (textarea) textarea.value = token;

      const hcapResponse = document.querySelector('[name="h-captcha-response"]');
      if (hcapResponse) hcapResponse.value = token;

      if (window.hcaptcha) window.hcaptcha.execute();
    }, token);
  }
}
