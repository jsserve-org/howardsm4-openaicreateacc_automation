import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { AIBrowserAgent } from './utils/ai-agent.js';
import { CloudflareEmailHandler } from './utils/email-handler.js';
import { faker } from '@faker-js/faker';
import { generateEmail, log, delay, randomDelay } from './utils/helpers.js';
import path from 'path';
import fs from 'fs';

dotenv.config();

const userDataDir = path.resolve('browser-data/ai-agent');

async function main() {
  log('=== AI-Powered ChatGPT Account Creator ===');
  log(`Model: ${process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-20250514'}`);

  if (!process.env.OPENROUTER_API_KEY) {
    log('OPENROUTER_API_KEY not set. Add it to .env file.', 'ERROR');
    log('Get your key at: https://openrouter.ai/keys');
    process.exit(1);
  }

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const testEmail = generateEmail();
  log(`Generated email: ${testEmail}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    bypassCSP: true,
    ignoreHTTPSErrors: true,
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

  const agent = new AIBrowserAgent(page, {
    maxSteps: 40,
  });

  try {
    await page.goto('https://chat.openai.com/auth/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    const task = `Create a new ChatGPT account with this email: ${testEmail}

IMPORTANT: Do NOT use Google, Apple, or Microsoft sign-in. Use EMAIL signup only.

Steps:
1. Click "Sign up" or "Sign up for free" button
2. If you see "Continue with Google/Apple/Microsoft" buttons, IGNORE them
3. Look for an email input field or "Continue with email" option
4. Enter the email: ${testEmail}
5. Press Enter key to submit
6. Wait for the verification code input to appear (a single field asking for a 6-digit code)
7. As soon as you see the verification code input, immediately respond with action "done" and result "VERIFICATION_CODE_NEEDED" — do NOT type anything in it; the code will be entered by the host script.
8. If you see a CAPTCHA or Cloudflare challenge, try to solve it by clicking the checkbox
9. If redirected to Google/Apple sign-in, go BACK and try email signup instead
10. If you hit an error page, go back to chat.openai.com/auth/login and try again

NEVER try to sign in with Google. Always use email.`;

    const result = await agent.run(task);

    log('\n=== Agent Result ===');
    log(JSON.stringify(result, null, 2));

    await page.screenshot({ path: 'screenshots/ai-agent-after-signup.png' });

    const needsCode = await detectVerificationInput(page);

    if (needsCode) {
      log('Verification code input detected — fetching code from Cloudflare...');
      const ok = await fetchAndEnterCode(page, testEmail);
      if (ok) {
        log(`Verification code submitted for: ${testEmail}`);
        const profileFilled = await fillAboutYou(page);
        if (profileFilled) {
          log(`Account fully created: ${testEmail}`);
        } else {
          log(`Verification passed but profile step did not complete for ${testEmail}`, 'WARN');
        }
        await page.screenshot({ path: 'screenshots/ai-agent-final.png' });
      } else {
        log(`Failed to complete verification for ${testEmail}`, 'ERROR');
        await page.screenshot({ path: 'screenshots/ai-agent-verification-failed.png' });
      }
    } else {
      log('No verification code input visible — saving final screenshot.');
      await page.screenshot({ path: 'screenshots/ai-agent-final.png' });
    }

  } catch (error) {
    log(`Error: ${error.message}`, 'ERROR');
    await page.screenshot({ path: 'screenshots/ai-agent-error.png' });
  } finally {
    log('Browser kept open for inspection. Close manually when done.');
  }
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

async function fetchAndEnterCode(page, email) {
  const emailHandler = new CloudflareEmailHandler();

  let code;
  try {
    code = await emailHandler.getVerificationCode(email, {
      maxAttempts: 60,
      interval: 3000,
    });
  } catch (e) {
    log(`Could not retrieve verification code: ${e.message}`, 'ERROR');
    return false;
  }

  if (!code) return false;

  const selector = 'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name="otp"], input[name="verification_code"]';
  const input = page.locator(selector).first();

  try {
    await input.click({ timeout: 5000 });
    await randomDelay(200, 500);
    await input.fill('');
    await input.type(code, { delay: 100 });
    await randomDelay(800, 1500);
  } catch (e) {
    log(`Failed to type code into input: ${e.message}`, 'ERROR');
    return false;
  }

  const submit = page.locator('button:has-text("Continue"), button[type="submit"]').first();
  try {
    await submit.click({ timeout: 5000 });
  } catch {
    await page.keyboard.press('Enter');
  }

  await delay(5000);
  return true;
}

async function fillAboutYou(page) {
  log('Waiting for "About you" / age page...');

  try {
    await page.waitForURL(/\/about-you|\/onboarding|\/profile|\/welcome/i, { timeout: 25000 });
  } catch {
    log('URL did not match about-you; probing anyway.');
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await delay(2000);

  const fullName = `${faker.person.firstName()} ${faker.person.lastName()}`;
  const age = 18 + Math.floor(Math.random() * 30);
  log(`Filling profile: name="${fullName}", age=${age}`);

  const nameLoc = page.getByLabel(/full\s*name|^name$/i).first();
  const ageLoc = page.getByLabel(/age/i).first();

  try {
    await nameLoc.waitFor({ state: 'visible', timeout: 15000 });
    await nameLoc.fill(fullName, { timeout: 10000 });
    await randomDelay(300, 700);
  } catch (e) {
    log(`Failed to fill full name via label: ${e.message}`, 'ERROR');
    return false;
  }

  try {
    await ageLoc.waitFor({ state: 'visible', timeout: 10000 });
    await ageLoc.fill(String(age), { timeout: 10000 });
    await randomDelay(300, 700);
  } catch (e) {
    log(`Failed to fill age via label: ${e.message}`, 'ERROR');
    return false;
  }

  const finishBtn = page
    .getByRole('button', { name: /finish creating account|finish|continue/i })
    .first();

  try {
    await finishBtn.click({ timeout: 8000 });
  } catch {
    await page.keyboard.press('Enter');
  }

  await delay(6000);
  log(`Final URL: ${page.url()}`);

  await skipOnboarding(page);
  return true;
}

async function skipOnboarding(page) {
  try {
    await page.waitForURL(/chatgpt\.com|chat\.openai\.com/i, { timeout: 15000 });
  } catch {
    log('Did not reach chatgpt.com onboarding within 15s.', 'WARN');
    return false;
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await delay(1500);

  // Loop through any "Skip" / "Next" / "Maybe later" steps we can find.
  for (let i = 0; i < 6; i++) {
    const skipBtn = page.getByRole('button', { name: /^skip$|maybe later|not now/i }).first();
    const skipLink = page.getByRole('link', { name: /^skip$|maybe later|not now/i }).first();
    const skipText = page.locator('button:has-text("Skip"), a:has-text("Skip"), [role="button"]:has-text("Skip")').first();

    let clicked = false;
    for (const target of [skipBtn, skipLink, skipText]) {
      try {
        if (await target.isVisible({ timeout: 1000 })) {
          await target.click({ timeout: 3000 });
          log(`Clicked skip on onboarding step ${i + 1}.`);
          clicked = true;
          break;
        }
      } catch {}
    }

    if (!clicked) {
      log(`No more skip button found after ${i} steps. Final URL: ${page.url()}`);
      return true;
    }
    await delay(2500);
  }

  log(`Onboarding skip loop exhausted. Final URL: ${page.url()}`);
  return true;
}

main().catch(console.error);
