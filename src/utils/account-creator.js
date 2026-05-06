import { chromium } from 'playwright';
import { TIMEOUTS } from '../config/constants.js';
import { generateEmail, generatePassword, generateName, randomDelay, log } from './helpers.js';
import { CloudflareEmailHandler } from './email-handler.js';
import { CaptchaSolver } from './captcha-solver.js';
import path from 'path';
import fs from 'fs';

export class ChatGPTAccountCreator {
  constructor(options = {}) {
    this.headless = options.headless ?? (process.env.HEADLESS !== 'false');
    this.slowMo = options.slowMo ?? parseInt(process.env.SLOW_MO || '100');
    this.proxy = options.proxy ?? null;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.accountData = null;
    this.emailHandler = new CloudflareEmailHandler();
    this.captchaSolver = new CaptchaSolver();
    this.userDataDir = path.resolve('browser-data');
  }

  async initialize() {
    log('Initializing browser with persistent context...');

    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    const contextOptions = {
      headless: this.headless,
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      bypassCSP: true,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-popup-blocking',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        '--window-size=1280,720',
      ],
    };

    if (this.proxy) {
      contextOptions.proxy = {
        server: this.proxy.server || process.env.PROXY_SERVER,
        username: this.proxy.username || process.env.PROXY_USERNAME,
        password: this.proxy.password || process.env.PROXY_PASSWORD,
      };
    }

    this.context = await chromium.launchPersistentContext(this.userDataDir, contextOptions);
    this.page = await this.context.newPage();

    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: { isInstalled: false },
      };

      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          rtt: 50,
          downlink: 10,
          effectiveType: '4g',
          saveData: false,
        }),
      });
    });

    this.accountData = {
      email: generateEmail(),
      password: generatePassword(),
      name: generateName(),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    log(`Generated account data for: ${this.accountData.email}`);
    return this;
  }

  async waitForPageLoad(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const title = await this.page.title();
      if (title && !title.includes('Just a moment') && !title.includes('Checking')) {
        return true;
      }
      await this.page.waitForTimeout(1000);
    }
    return false;
  }

  async solveCaptcha() {
    log('Checking for CAPTCHA...');
    
    const frames = this.page.frames();
    for (const frame of frames) {
      const frameUrl = frame.url();
      if (frameUrl.includes('challenges.cloudflare.com') && frameUrl.includes('turnstile')) {
        log('Turnstile detected, attempting to solve...');
        const sitekeyMatch = frameUrl.match(/(0x[a-zA-Z0-9]+)/);
        if (sitekeyMatch) {
          const sitekey = sitekeyMatch[1];
          log(`Turnstile sitekey: ${sitekey}`);
          
          if (this.captchaSolver.isConfigured()) {
            try {
              const solution = await this.captchaSolver.solveTurnstile(sitekey, this.page.url());
              const token = solution.gRecaptchaResponse || solution.token;
              log('Turnstile solved, injecting token...');
              
              await this.page.evaluate((token) => {
                const input = document.querySelector('input[name="cf-turnstile-response"]');
                if (input) {
                  input.value = token;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }, token);
              
              log('Token injected successfully');
              await randomDelay(1000, 2000);
              return true;
            } catch (e) {
              log(`Failed to solve Turnstile: ${e.message}`, 'ERROR');
            }
          } else {
            log('No CAPTCHA_API_KEY configured - cannot solve Turnstile');
          }
        }
      }
    }
    return false;
  }

  async waitForAndSolveCaptcha(timeout = 20000) {
    log('Waiting for Turnstile to appear...');
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const frames = this.page.frames();
      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('challenges.cloudflare.com') && frameUrl.includes('turnstile')) {
          log('Turnstile iframe found');
          return this.solveCaptcha();
        }
      }
      await this.page.waitForTimeout(1000);
    }
    
    log('No Turnstile detected within timeout');
    return false;
  }

  async navigateToSignup() {
    log('Navigating to ChatGPT login page...');
    await this.page.goto('https://chat.openai.com/auth/login', {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.navigation,
    });

    const pageLoaded = await this.waitForPageLoad(20000);
    if (!pageLoaded) {
      log('Page still showing challenge, attempting CAPTCHA solve...');
      await this.solveCaptcha();
      await this.waitForPageLoad(15000);
    }

    await randomDelay(2000, 3000);

    const signupBtn = this.page.locator('button:has-text("Sign up"), a:has-text("Sign up")');
    const visible = await signupBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!visible) {
      throw new Error('Signup button not found');
    }

    log('Clicking Sign Up...');
    await signupBtn.first().click();
    await randomDelay(3000, 4000);

    const signupFreeBtn = this.page.locator('button:has-text("Sign up for free")');
    const freeVisible = await signupFreeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (freeVisible) {
      log('Found "Sign up for free" button');
      
      await this.waitForAndSolveCaptcha(15000);
      
      log('Clicking Sign up for free...');
      await signupFreeBtn.click();
      await randomDelay(3000, 5000);

      const url = this.page.url();
      log(`Current URL: ${url}`);

      if (url.includes('auth/error')) {
        log('Auth error detected, attempting CAPTCHA solve...');
        const solved = await this.waitForAndSolveCaptcha(10000);
        if (solved) {
          log('CAPTCHA solved, retrying signup...');
          await this.page.goBack();
          await randomDelay(2000, 3000);
          await signupFreeBtn.click();
          await randomDelay(3000, 5000);
        } else {
          await this.takeScreenshot('auth-error');
          throw new Error('Auth error after signup - CAPTCHA could not be solved');
        }
      }
    }
  }

  async submitEmail() {
    log('Submitting email...');
    const { email } = this.accountData;

    const emailInput = await this.page.waitForSelector(
      'input[name="email"], input[type="email"][placeholder*="Email"]',
      { timeout: TIMEOUTS.element }
    ).catch(() => null);

    if (!emailInput) {
      log('Email input not found');
      await this.takeScreenshot('no-email-input');
      throw new Error('Email input not found');
    }

    await emailInput.click();
    await randomDelay(300, 500);
    await emailInput.type(email, { delay: 80 });
    await randomDelay(500, 1000);

    const continueBtn = this.page.locator('button:has-text("Continue")');
    await continueBtn.click();
    await randomDelay(3000, 5000);
    log('Email submitted');
  }

  async handlePasswordStep() {
    const { password } = this.accountData;

    const passwordInput = await this.page.waitForSelector(
      'input[type="password"]',
      { timeout: 8000 }
    ).catch(() => null);

    if (passwordInput) {
      log('Password field found, entering password...');
      await passwordInput.click();
      await randomDelay(300, 500);
      await passwordInput.type(password, { delay: 80 });
      await randomDelay(500, 1000);

      const continueBtn = this.page.locator('button:has-text("Continue")');
      await continueBtn.click();
      await randomDelay(2000, 3000);
      return true;
    }

    log('No password field - passwordless flow detected');
    return false;
  }

  async handleNameStep() {
    const nameInput = await this.page.waitForSelector(
      'input[name="name"], input[placeholder*="name" i], input[placeholder*="Name"]',
      { timeout: 8000 }
    ).catch(() => null);

    if (nameInput) {
      log('Name field found, entering name...');
      await nameInput.click();
      await randomDelay(300, 500);
      await nameInput.type(this.accountData.name, { delay: 80 });
      await randomDelay(500, 1000);

      const continueBtn = this.page.locator('button:has-text("Continue")');
      await continueBtn.click();
      await randomDelay(2000, 3000);
      return true;
    }
    return false;
  }

  async handleVerificationCode() {
    log('Looking for verification code input...');

    const codeInput = await this.page.waitForSelector(
      'input[name="code"], input[type="text"], input[autocomplete="one-time-code"], input[inputmode="numeric"]',
      { timeout: 15000 }
    ).catch(() => null);

    if (!codeInput) {
      log('No verification code input found');
      await this.takeScreenshot('no-code-input');
      return false;
    }

    log('Verification code input found, fetching code from Cloudflare...');

    try {
      const code = await this.emailHandler.getVerificationCode(this.accountData.email, {
        maxAttempts: 40,
        interval: 3000,
      });

      if (code) {
        log(`Entering verification code: ${code}`);
        await codeInput.click();
        await randomDelay(300, 500);
        await codeInput.type(code, { delay: 120 });
        await randomDelay(1000, 2000);

        const submitBtn = this.page.locator('button:has-text("Continue"), button[type="submit"]');
        await submitBtn.click();
        await randomDelay(3000, 5000);
        return true;
      }
    } catch (error) {
      log(`Failed to get verification code: ${error.message}`, 'ERROR');
    }

    await this.takeScreenshot('verification-failed');
    return false;
  }

  async takeScreenshot(name) {
    const screenshotPath = `screenshots/${name}-${Date.now()}.png`;
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    log(`Screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  }

  async createAccount(options = {}) {
    try {
      await this.initialize();
      await this.navigateToSignup();

      await this.submitEmail();
      await this.handlePasswordStep();
      await this.handleNameStep();

      const verified = await this.handleVerificationCode();
      if (verified) {
        this.accountData.status = 'created';
        log(`Account created successfully: ${this.accountData.email}`);
      } else {
        this.accountData.status = 'verification_pending';
        log(`Verification pending for: ${this.accountData.email}`);
      }

      await this.takeScreenshot('final');
      return this.accountData;

    } catch (error) {
      log(`Error during account creation: ${error.message}`, 'ERROR');
      this.accountData.status = 'failed';
      this.accountData.error = error.message;
      await this.takeScreenshot('error');
      return this.accountData;

    } finally {
      if (options.keepBrowser) {
        log('Browser kept open for debugging');
      } else {
        await this.close();
      }
    }
  }

  async close() {
    if (this.context) {
      await this.context.close();
      log('Browser closed');
    }
  }
}
