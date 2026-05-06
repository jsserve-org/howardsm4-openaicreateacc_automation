import { chromium } from 'playwright';
import { faker } from '@faker-js/faker';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AIBrowserAgent } from '../utils/ai-agent.js';
import { CloudflareEmailHandler } from '../utils/email-handler.js';
import { generateEmail, delay, randomDelay } from '../utils/helpers.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');

// Reusable end-to-end ChatGPT account creation flow.
//
// Options:
//   onProgress(step, info) — called with named lifecycle steps
//   headless              — boolean, defaults to true
//   codexOAuthUrl         — optional; after account creation, navigate here in
//                           the same browser context, capture the OAuth callback
//                           URL (any localhost redirect), and return it
//   keepOpen              — keep browser open after success (debug only)
//
// Returns: { email, session, codexCallbackUrl?, finalUrl }
//   session is the parsed JSON from https://chatgpt.com/api/auth/session.

const PROGRESS_STEPS = {
  starting: 'starting',
  signupAgent: 'agent_running_signup',
  awaitingHuman: 'awaiting_human',
  awaitingOtp: 'awaiting_otp',
  fetchingOtp: 'fetching_otp',
  submittingOtp: 'submitting_otp',
  fillingProfile: 'filling_profile',
  skippingOnboarding: 'skipping_onboarding',
  fetchingSession: 'fetching_session',
  linkingCodex: 'linking_codex',
  done: 'done',
};

// Recognises Cloudflare Turnstile / "Just a moment…" interstitials.
async function isOnTurnstile(page) {
  try {
    const url = page.url();
    if (/^https?:\/\/[^/]*\/cdn-cgi\//.test(url)) return true;
    const title = await page.title().catch(() => '');
    if (/just a moment/i.test(title)) return true;
    const has = await page.evaluate(() => {
      if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return true;
      if (document.querySelector('[data-sitekey]')) return true;
      const txt = document.body?.innerText || '';
      return /verify you are human|just a moment/i.test(txt);
    }).catch(() => false);
    return !!has;
  } catch {
    return false;
  }
}

// Pause the flow when Turnstile is up and yield to the human (remote-control
// panel in the dashboard, or the visible browser window in dev mode).
async function waitForHumanIfChallenge(page, emit, { timeout = 180000 } = {}) {
  if (!(await isOnTurnstile(page))) return;
  emit(PROGRESS_STEPS.awaitingHuman, { reason: 'cloudflare_turnstile' });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await delay(2000);
    if (!(await isOnTurnstile(page))) return;
  }
  throw new Error('Cloudflare challenge not solved within timeout');
}

export async function createAccount({
  onProgress = () => {},
  onPageReady = () => {},
  headless = true,
  codexOAuthUrl = null,
  keepOpen = false,
  screenshotDir = null,
} = {}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const email = generateEmail();
  const emit = (step, info = {}) => onProgress(step, { ...info, email });

  emit(PROGRESS_STEPS.starting);

  // Using a persistent context (warm profile) is the difference between
  // passing Cloudflare's Turnstile challenge and getting stuck on it.
  const baseDir = path.isAbsolute(process.env.BROWSER_DATA_DIR || '')
    ? process.env.BROWSER_DATA_DIR
    : path.join(REPO_ROOT, process.env.BROWSER_DATA_DIR || 'browser-data');
  // Fresh per-run profile dir — Cloudflare seems to flag profiles that have
  // failed challenges recently, and reusing one gets us into a bad cookie
  // state. We still use launchPersistentContext (vs. ephemeral newContext)
  // because that's what consistently passes the initial Turnstile check.
  const userDataDir = path.join(baseDir, `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    // Strip Playwright's default --enable-automation flag — it's a strong
    // bot signal that Cloudflare's Turnstile checks for.
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
    ],
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Hand the live page to the caller so it can drive a remote-control panel
  // (screencast + click forwarding) while the flow runs.
  try { onPageReady(page); } catch {}

  // Capture a screenshot if anything throws, so the UI can show what the
  // browser was actually looking at when the flow gave up.
  let lastError = null;
  let errorScreenshotPath = null;
  const captureFailureScreenshot = async (label) => {
    if (!screenshotDir) return null;
    fs.mkdirSync(screenshotDir, { recursive: true });
    const file = path.join(screenshotDir, `${label}-${Date.now()}.png`);
    try {
      await page.screenshot({ path: file, fullPage: true });
      return file;
    } catch {
      return null;
    }
  };

  try {
    await page.goto('https://chat.openai.com/auth/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Cloudflare may show Turnstile before we even reach the form. Yield to
    // the human (visible browser window in dev mode, or remote-control panel
    // in the dashboard) until it clears.
    await waitForHumanIfChallenge(page, emit);

    emit(PROGRESS_STEPS.signupAgent);
    const agent = new AIBrowserAgent(page, { maxSteps: 40 });
    await agent.run(buildSignupTask(email));

    // Some flows show another challenge after submitting the email.
    await waitForHumanIfChallenge(page, emit);

    emit(PROGRESS_STEPS.awaitingOtp);
    if (!(await detectVerificationInput(page))) {
      throw new Error('No verification code input appeared after agent flow');
    }

    emit(PROGRESS_STEPS.fetchingOtp);
    const code = await new CloudflareEmailHandler().getVerificationCode(email, {
      maxAttempts: 60,
      interval: 3000,
    });
    emit(PROGRESS_STEPS.submittingOtp, { code });
    await submitOtp(page, code);

    emit(PROGRESS_STEPS.fillingProfile);
    await fillAboutYou(page);

    emit(PROGRESS_STEPS.skippingOnboarding);
    await skipOnboarding(page);

    let codexCallbackUrl = null;
    if (codexOAuthUrl) {
      emit(PROGRESS_STEPS.linkingCodex);
      codexCallbackUrl = await captureCodexCallback(page, codexOAuthUrl);
    }

    emit(PROGRESS_STEPS.fetchingSession);
    const session = await fetchSession(page);

    emit(PROGRESS_STEPS.done);
    return { email, session, codexCallbackUrl, finalUrl: page.url() };
  } catch (e) {
    lastError = e;
    errorScreenshotPath = await captureFailureScreenshot('error');
    e.screenshotPath = errorScreenshotPath;
    throw e;
  } finally {
    if (!keepOpen) {
      // launchPersistentContext owns the browser internally; closing the
      // context shuts down the browser process too.
      await context.close().catch(() => {});
      // Clean up the per-run profile.
      fs.rm(userDataDir, { recursive: true, force: true }, () => {});
    }
  }
}

export async function linkCodex(oauthUrl, { onProgress = () => {} } = {}) {
  // Standalone Codex link flow — uses an existing logged-in account by reading
  // a stored session blob is out of scope here; this opens a fresh browser, lets
  // the user log in, then captures the callback. For now we assume the caller
  // chains it after createAccount via the codexOAuthUrl option.
  throw new Error('Standalone linkCodex is not implemented; pass codexOAuthUrl to createAccount instead.');
}

function buildSignupTask(email) {
  return `Create a new ChatGPT account with this email: ${email}

IMPORTANT: Do NOT use Google, Apple, or Microsoft sign-in. Use EMAIL signup only.

Steps:
1. Click "Sign up" or "Sign up for free" button
2. If you see "Continue with Google/Apple/Microsoft" buttons, IGNORE them
3. Look for an email input field or "Continue with email" option
4. Enter the email: ${email}
5. Press Enter key to submit
6. Wait for the verification code input to appear (a single field asking for a 6-digit code)
7. As soon as you see the verification code input, immediately respond with action "done" and result "VERIFICATION_CODE_NEEDED" — do NOT type anything in it; the code will be entered by the host script.
8. If you see a CAPTCHA or Cloudflare challenge, try to solve it by clicking the checkbox
9. If redirected to Google/Apple sign-in, go BACK and try email signup instead
10. If you hit an error page, go back to chat.openai.com/auth/login and try again

NEVER try to sign in with Google. Always use email.`;
}

async function detectVerificationInput(page) {
  const selector = 'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name="otp"], input[name="verification_code"]';
  try {
    await page.waitForSelector(selector, { timeout: 8000, state: 'visible' });
    return true;
  } catch {
    return false;
  }
}

async function submitOtp(page, code) {
  const selector = 'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name="otp"], input[name="verification_code"]';
  const input = page.locator(selector).first();

  await input.click({ timeout: 5000 });
  await randomDelay(200, 500);
  await input.fill('');
  await input.type(code, { delay: 100 });
  await randomDelay(800, 1500);

  const submit = page.locator('button:has-text("Continue"), button[type="submit"]').first();
  try {
    await submit.click({ timeout: 5000 });
  } catch {
    await page.keyboard.press('Enter');
  }

  await delay(5000);
}

async function fillAboutYou(page) {
  try {
    await page.waitForURL(/\/about-you|\/onboarding|\/profile|\/welcome/i, { timeout: 25000 });
  } catch {}

  await page.waitForLoadState('networkidle').catch(() => {});
  await delay(2000);

  const fullName = `${faker.person.firstName()} ${faker.person.lastName()}`;
  const age = 18 + Math.floor(Math.random() * 30);

  const nameLoc = page.getByLabel(/full\s*name|^name$/i).first();
  const ageLoc = page.getByLabel(/age/i).first();

  await nameLoc.waitFor({ state: 'visible', timeout: 30000 });
  await nameLoc.fill(fullName, { timeout: 15000 });
  await randomDelay(300, 700);

  await ageLoc.waitFor({ state: 'visible', timeout: 20000 });
  await ageLoc.fill(String(age), { timeout: 15000 });
  await randomDelay(300, 700);

  const finishBtn = page.getByRole('button', { name: /finish creating account|finish|continue/i }).first();
  try {
    await finishBtn.click({ timeout: 8000 });
  } catch {
    await page.keyboard.press('Enter');
  }

  await delay(6000);
}

async function skipOnboarding(page) {
  try {
    await page.waitForURL(/chatgpt\.com|chat\.openai\.com/i, { timeout: 15000 });
  } catch {
    return;
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await delay(1500);

  for (let i = 0; i < 6; i++) {
    const candidates = [
      page.getByRole('button', { name: /^skip$|maybe later|not now/i }).first(),
      page.getByRole('link', { name: /^skip$|maybe later|not now/i }).first(),
      page.locator('button:has-text("Skip"), a:has-text("Skip"), [role="button"]:has-text("Skip")').first(),
    ];

    let clicked = false;
    for (const target of candidates) {
      try {
        if (await target.isVisible({ timeout: 1000 })) {
          await target.click({ timeout: 3000 });
          clicked = true;
          break;
        }
      } catch {}
    }
    if (!clicked) return;
    await delay(2500);
  }
}

async function fetchSession(page) {
  // The endpoint returns a JSON document. Reading via page.goto + body innerText
  // works without needing CORS or headers.
  await page.goto('https://chatgpt.com/api/auth/session', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const text = await page.evaluate(() => document.body.innerText);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// Visit the OAuth URL inside the logged-in browser context, intercept the
// localhost redirect (which would otherwise fail to load), and return the URL
// the OAuth flow tries to redirect to.
async function captureCodexCallback(page, oauthUrl) {
  let captured = null;

  // Match any localhost callback (the user's CLI listener).
  const isCallback = (url) => /^http:\/\/(localhost|127\.0\.0\.1):\d+\/.*\bcode=/.test(url);

  // Abort the navigation to the local CLI so the page doesn't hang on a load.
  await page.route('**/*', (route, request) => {
    if (isCallback(request.url())) {
      captured = request.url();
      return route.abort();
    }
    return route.continue();
  });

  // Also catch via request event in case routing missed it.
  page.on('request', (request) => {
    const url = request.url();
    if (isCallback(url)) captured = captured || url;
  });

  await page.goto(oauthUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

  // Some flows show a consent screen — try to click the "Allow" / "Authorize" button.
  for (let i = 0; i < 4 && !captured; i++) {
    const consentBtn = page
      .getByRole('button', { name: /authorize|allow|continue|approve|accept/i })
      .first();
    try {
      if (await consentBtn.isVisible({ timeout: 2000 })) {
        await consentBtn.click({ timeout: 3000 });
      }
    } catch {}
    await delay(1500);
  }

  // Wait up to 15s for the redirect to fire.
  const deadline = Date.now() + 15000;
  while (!captured && Date.now() < deadline) {
    await delay(500);
  }

  await page.unroute('**/*').catch(() => {});

  if (!captured) {
    throw new Error('Codex OAuth callback was not captured — consent flow may have failed');
  }
  return captured;
}
