import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { AIBrowserAgent } from './utils/ai-agent.js';
import { generateEmail, log } from './utils/helpers.js';
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
6. Wait for verification code input
7. Report "VERIFICATION_CODE_NEEDED" when you see the code input
7. If asked for name, use: TestUser
8. If you see a CAPTCHA or Cloudflare challenge, try to solve it by clicking the checkbox
9. If you see a verification code input, report back - we'll fetch the code from email
10. If redirected to Google/Apple sign-in, go BACK and try email signup instead
11. If you hit an error page, go back to chat.openai.com/auth/login and try again

NEVER try to sign in with Google. Always use email.`;

    const result = await agent.run(task);

    log('\n=== Result ===');
    log(JSON.stringify(result, null, 2));

    await page.screenshot({ path: 'screenshots/ai-agent-final.png' });

  } catch (error) {
    log(`Error: ${error.message}`, 'ERROR');
    await page.screenshot({ path: 'screenshots/ai-agent-error.png' });
  } finally {
    log('Browser kept open for inspection. Close manually when done.');
  }
}

main().catch(console.error);
