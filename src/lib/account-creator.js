import { chromium } from 'playwright';
import { faker } from '@faker-js/faker';
import { AIBrowserAgent } from '../utils/ai-agent.js';
import { CloudflareEmailHandler } from '../utils/email-handler.js';
import { generateEmail, delay, randomDelay } from '../utils/helpers.js';

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
  awaitingOtp: 'awaiting_otp',
  fetchingOtp: 'fetching_otp',
  submittingOtp: 'submitting_otp',
  fillingProfile: 'filling_profile',
  skippingOnboarding: 'skipping_onboarding',
  fetchingSession: 'fetching_session',
  linkingCodex: 'linking_codex',
  done: 'done',
};

export async function createAccount({
  onProgress = () => {},
  headless = true,
  codexOAuthUrl = null,
  keepOpen = false,
} = {}) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const email = generateEmail();
  const emit = (step, info = {}) => onProgress(step, { ...info, email });

  emit(PROGRESS_STEPS.starting);

  const browser = await chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    bypassCSP: true,
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  try {
    await page.goto('https://chat.openai.com/auth/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    emit(PROGRESS_STEPS.signupAgent);
    const agent = new AIBrowserAgent(page, { maxSteps: 40 });
    await agent.run(buildSignupTask(email));

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
  } finally {
    if (!keepOpen) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
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

  await nameLoc.waitFor({ state: 'visible', timeout: 15000 });
  await nameLoc.fill(fullName, { timeout: 10000 });
  await randomDelay(300, 700);

  await ageLoc.waitFor({ state: 'visible', timeout: 10000 });
  await ageLoc.fill(String(age), { timeout: 10000 });
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
