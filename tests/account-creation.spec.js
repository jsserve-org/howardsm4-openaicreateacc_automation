import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import { generateEmail, log } from '../src/utils/helpers.js';
import { CaptchaSolver } from '../src/utils/captcha-solver.js';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('browser-data/test-session');

async function launchStealthBrowser() {
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
    ],
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {} };
  });

  return { context, page };
}

async function waitForPageLoad(page, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const title = await page.title();
    const url = page.url();
    if (title && !title.includes('Just a moment') && !title.includes('Checking')) {
      return { loaded: true, title, url };
    }
    if (url.includes('/auth/login') && !url.includes('challenge')) {
      await page.waitForTimeout(2000);
      const newTitle = await page.title();
      if (newTitle && !newTitle.includes('Just a moment')) {
        return { loaded: true, title: newTitle, url };
      }
    }
    await page.waitForTimeout(1000);
  }
  return { loaded: false, title: await page.title(), url: page.url() };
}

test.describe('ChatGPT Account Creation', () => {
  test('should load chatgpt and detect Turnstile', async () => {
    const { context, page } = await launchStealthBrowser();

    try {
      await page.goto('https://chat.openai.com/auth/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

      const result = await waitForPageLoad(page, 25000);
      log(`Page loaded: ${result.loaded}, Title: ${result.title}, URL: ${result.url}`);

      const frames = page.frames();
      log(`Total frames: ${frames.length}`);

      let turnstileFound = false;
      let turnstileSitekey = null;

      for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('challenges.cloudflare.com')) {
          log(`Challenge frame: ${frameUrl}`);
          const sitekeyMatch = frameUrl.match(/(0x[a-zA-Z0-9]+)/);
          if (sitekeyMatch) {
            turnstileSitekey = sitekeyMatch[1];
            turnstileFound = true;
            log(`Turnstile sitekey: ${turnstileSitekey}`);
            log(`Sitekey length: ${turnstileSitekey.length}`);
          } else {
            log('No sitekey match found in frame URL');
          }
        }
      }

      if (turnstileFound && process.env.CAPTCHA_API_KEY) {
        log('Attempting to solve Turnstile...');
        const solver = new CaptchaSolver();
        const solveResult = await solver.detectAndSolve(page);
        log(`Solve result: ${JSON.stringify(solveResult)}`);

        if (solveResult.solved) {
          await page.waitForTimeout(5000);
          const afterTitle = await page.title();
          log(`After solve title: ${afterTitle}`);
        }
      }

      await page.screenshot({ path: 'screenshots/turnstile-detection.png' });
      log('Test completed');
    } finally {
      await context.close();
    }
  });

  test('should attempt full account creation flow', async () => {
    const { context, page } = await launchStealthBrowser();

    try {
      await page.goto('https://chat.openai.com/auth/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

      const result = await waitForPageLoad(page, 30000);
      log(`Initial load: ${result.loaded}, Title: ${result.title}`);

      if (!result.loaded) {
        log('Page still showing challenge, waiting more...');
        await page.waitForTimeout(10000);
        const title = await page.title();
        log(`Title after wait: ${title}`);
      }

      await page.waitForTimeout(3000);

      const signupBtn = page.locator('button:has-text("Sign up"), a:has-text("Sign up")');
      const signupVisible = await signupBtn.isVisible({ timeout: 15000 }).catch(() => false);

      if (!signupVisible) {
        log('Signup button not visible - Cloudflare still blocking or page not loaded');
        await page.screenshot({ path: 'screenshots/signup-not-visible.png' });
        test.skip();
        return;
      }

      log('Clicking signup button...');
      await signupBtn.first().click();
      
      await page.waitForTimeout(3000);
      log(`URL after click: ${page.url()}`);

      const signupFreeBtn = page.locator('button:has-text("Sign up for free")');
      const signupFreeVisible = await signupFreeBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (signupFreeVisible) {
      log('Found "Sign up for free" button, clicking...');
      await signupFreeBtn.click();
      await page.waitForTimeout(5000);
      log(`URL after Sign up for free: ${page.url()}`);

      await page.goto('https://auth.openai.com/log-in-or-create-account', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(5000);
      log(`Auth page URL: ${page.url()}`);

      const bodyText = await page.locator('body').innerText();
      log(`Auth page text: ${bodyText.substring(0, 500)}`);

      const loginBtn = page.locator('button:has-text("Log in"), a:has-text("Log in")');
      const loginVisible = await loginBtn.isVisible({ timeout: 5000 }).catch(() => false);
      
      if (loginVisible) {
        log('Found Log in button, clicking...');
        await loginBtn.click();
        await page.waitForTimeout(5000);
        log(`After login click URL: ${page.url()}`);
        
        const newBodyText = await page.locator('body').innerText();
        log(`After login text: ${newBodyText.substring(0, 500)}`);
        
        const allInputs = await page.locator('input').all();
        log(`Inputs after login: ${allInputs.length}`);
        for (const input of allInputs) {
          const type = await input.getAttribute('type');
          const name = await input.getAttribute('name');
          const placeholder = await input.getAttribute('placeholder');
          const visible = await input.isVisible();
          log(`  Input: type=${type}, name=${name}, placeholder=${placeholder}, visible=${visible}`);
        }
      } else {
        log('No Log in button found');
      }

      await page.screenshot({ path: 'screenshots/auth-page.png' });
      }

      const allInputs = await page.locator('input').all();
      log(`Total inputs on page: ${allInputs.length}`);
      for (const input of allInputs) {
        const type = await input.getAttribute('type');
        const name = await input.getAttribute('name');
        const placeholder = await input.getAttribute('placeholder');
        const visible = await input.isVisible();
        log(`  Input: type=${type}, name=${name}, placeholder=${placeholder}, visible=${visible}`);
      }

      await page.screenshot({ path: 'screenshots/after-signup-click.png' });
      
      try {
        await page.waitForURL(/auth\.openai\.com/, { timeout: 10000 });
      } catch {
        await page.waitForTimeout(5000);
      }
      
      log(`After signup URL: ${page.url()}`);
      await page.waitForTimeout(3000);

      const emailInput = page.locator('input[name="email"], input[type="email"]');
      const emailVisible = await emailInput.isVisible({ timeout: 15000 }).catch(() => false);

      if (!emailVisible) {
        log('Email input not visible after signup click');
        await page.screenshot({ path: 'screenshots/no-email-input.png' });
        test.skip();
        return;
      }

      const testEmail = generateEmail();
      await emailInput.fill(testEmail);
      await page.waitForTimeout(500);

      const continueBtn = page.locator('button:has-text("Continue")');
      await continueBtn.click();
      await page.waitForTimeout(5000);

      await page.screenshot({ path: 'screenshots/after-email-submit.png' });
      log(`Email submitted: ${testEmail}`);
    } finally {
      await context.close();
    }
  });
});
