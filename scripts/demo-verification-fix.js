// Demo of the verification-code fix in ai-create-account.js.
// Spins up a tiny local HTTP server that mimics the Cloudflare worker's
// /get-code endpoint, then drives a fake "verification" page in Playwright
// through the same detect -> fetch -> type -> submit path the real script uses.

import http from 'http';
import { chromium } from 'playwright';
import { CloudflareEmailHandler } from '../src/utils/email-handler.js';
import { log, delay, randomDelay } from '../src/utils/helpers.js';

const PORT = 8799;
const FAKE_EMAIL = 'demo_user_123@example.test';
const FAKE_CODE = '482915';

// 1. Stand up a fake worker.
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/get-code')) {
    log(`[fake-worker] ${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: FAKE_CODE, receivedAt: new Date().toISOString() }));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});
await new Promise((r) => server.listen(PORT, r));
log(`Fake worker listening on http://127.0.0.1:${PORT}`);

// 2. Launch a browser with a fake "verification needed" page.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`
  <html><body style="font-family:sans-serif;padding:40px">
    <h2>Enter your verification code</h2>
    <form id="f" onsubmit="event.preventDefault();document.getElementById('out').textContent='SUBMITTED: '+document.querySelector('input[name=code]').value">
      <input name="code" autocomplete="one-time-code" inputmode="numeric" />
      <button type="submit">Continue</button>
    </form>
    <pre id="out"></pre>
  </body></html>
`);
log('Loaded fake "verification needed" page.');

// 3. Run the same logic that ai-create-account.js now uses.
async function detectVerificationInput(page) {
  const sel = 'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"]';
  try { await page.waitForSelector(sel, { timeout: 8000, state: 'visible' }); return true; }
  catch { return false; }
}

async function fetchAndEnterCode(page, email) {
  const handler = new CloudflareEmailHandler({
    workerUrl: `http://127.0.0.1:${PORT}`,
    apiToken: 'demo-token',
  });
  const code = await handler.getVerificationCode(email, { maxAttempts: 5, interval: 1000 });
  const input = page.locator('input[name="code"]').first();
  await input.click();
  await randomDelay(100, 200);
  await input.type(code, { delay: 50 });
  await page.locator('button[type="submit"]').click();
  await delay(500);
  return true;
}

const detected = await detectVerificationInput(page);
log(`detectVerificationInput -> ${detected}`);
if (detected) {
  await fetchAndEnterCode(page, FAKE_EMAIL);
}

const result = await page.locator('#out').textContent();
log(`Page reports: "${result}"`);

await browser.close();
server.close();

if (result === `SUBMITTED: ${FAKE_CODE}`) {
  log('DEMO PASS: verification code was fetched from worker and submitted.');
  process.exit(0);
} else {
  log('DEMO FAIL', 'ERROR');
  process.exit(1);
}
