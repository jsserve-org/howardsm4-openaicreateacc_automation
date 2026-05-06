import { log, delay, randomDelay } from './helpers.js';
import fs from 'fs';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';

export class AIBrowserAgent {
  constructor(page, options = {}) {
    this.page = page;
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    this.model = options.model || process.env.OPENROUTER_MODEL || 'google/gemma-3-27b-it:free';
    this.maxTokens = options.maxTokens || 1024;
    this.conversationHistory = [];
    this.maxSteps = options.maxSteps || 30;
    this.screenshotDir = options.screenshotDir || 'screenshots';
  }

  async takeScreenshot() {
    const path = `${this.screenshotDir}/agent-step-${Date.now()}.png`;
    await this.page.screenshot({ path, fullPage: false });
    return path;
  }

  screenshotToBase64(path) {
    const buffer = fs.readFileSync(path);
    return buffer.toString('base64');
  }

  async getPageInfo() {
    const url = this.page.url();
    const title = await this.page.title();
    const visibleInputs = await this.getVisibleInputs();
    const visibleButtons = await this.getVisibleButtons();
    return { url, title, visibleInputs, visibleButtons };
  }

  async getVisibleInputs() {
    const inputs = await this.page.locator('input:visible, textarea:visible').all();
    const result = [];
    for (const input of inputs) {
      const type = await input.getAttribute('type') || 'text';
      const name = await input.getAttribute('name') || '';
      const placeholder = await input.getAttribute('placeholder') || '';
      const value = await input.inputValue().catch(() => '');
      result.push({ type, name, placeholder, value });
    }
    return result;
  }

  async getVisibleButtons() {
    const buttons = await this.page.locator('button:visible, a:visible, [role="button"]:visible').all();
    const result = [];
    for (const btn of buttons) {
      const text = (await btn.textContent()).trim().substring(0, 50);
      if (text) result.push(text);
    }
    return result;
  }

  async callOpenRouter(messages, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const response = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/chatgpt-account-creator',
          'X-Title': 'ChatGPT Account Creator',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          messages,
        }),
      });

      if (response.status === 429) {
        const waitTime = attempt * 5000;
        log(`Rate limited, waiting ${waitTime/1000}s (attempt ${attempt}/${retries})...`);
        await delay(waitTime);
        continue;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    }

    throw new Error('Max retries exceeded for rate limiting');
  }

  async decide(task) {
    const screenshotPath = await this.takeScreenshot();
    const pageInfo = await this.getPageInfo();
    const base64 = this.screenshotToBase64(screenshotPath);

    const systemPrompt = `You are a browser automation agent. Your job is to complete tasks by interacting with web pages.

You will see a screenshot of the current browser page and information about visible elements.

RESPOND WITH ONLY A JSON OBJECT (no markdown, no explanation) with this format:
{
  "thought": "brief reasoning about what to do next",
  "action": "click" | "type" | "press" | "wait" | "scroll" | "done" | "fail",
  "selector": "CSS selector for click/type (optional)",
  "text": "text to type (for type action)",
  "key": "key to press (for press action, e.g. Enter, Tab)",
  "reason": "why this action",
  "result": "result summary (for done/fail)"
}

ACTIONS:
- click: Click an element. Use selector or describe the element.
- type: Type text into an input field.
- press: Press a keyboard key (Enter, Tab, Escape, etc).
- wait: Wait for page to load (use when page is loading/changing).
- scroll: Scroll down the page.
- done: Task is complete.
- fail: Task cannot be completed.

SELECTOR RULES - IMPORTANT:
- Use Playwright selectors, NOT jQuery
- For buttons with text: button:has-text("Sign up") or button:has-text("Continue")
- For inputs: input[type="email"], input[name="email"], input[placeholder*="Email"]
- NEVER use :contains() - it does not work in Playwright
- Use :has-text() for text matching
- Use input[type='email'] for email fields
- Use button:has-text('Accept all') for cookie consent
- CRITICAL: For the email "Continue" button, do NOT click "Continue with Google/Apple/phone"
  - After typing email, press Enter key instead of clicking Continue
  - OR click button:has-text('Continue'):not(:has-text('Continue with'))
  - OR use the submit button: button[type="submit"]

RULES:
1. Look at the screenshot carefully before deciding.
2. If you see a CAPTCHA/challenge, try to solve it or click the checkbox.
3. If a page is loading, use "wait" action.
4. If you see a form, fill it out step by step.
5. Always use the most specific selector possible.
7. After typing email in the input field, press Enter key to submit. Do NOT click Continue button as it may trigger Google OAuth.
8. If you see a CAPTCHA or Cloudflare challenge, try to solve it or use "wait" action.
9. If you see "Just a moment..." or Cloudflare challenge, use "wait" action.
10. If a click fails, try a different selector or press Enter key instead.`;

    const userMessage = {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${base64}` },
        },
        {
          type: 'text',
          text: `${systemPrompt}

TASK: ${task}

CURRENT PAGE INFO:
- URL: ${pageInfo.url}
- Title: ${pageInfo.title}
- Visible inputs: ${JSON.stringify(pageInfo.visibleInputs, null, 2)}
- Visible buttons: ${JSON.stringify(pageInfo.visibleButtons, null, 2)}

What is your next action? Respond with JSON only.`,
        },
      ],
    };

    this.conversationHistory.push(userMessage);
    const messages = [...this.conversationHistory];

    const assistantText = await this.callOpenRouter(messages);
    this.conversationHistory.push({ role: 'assistant', content: assistantText });

    try {
      const jsonMatch = assistantText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      log(`Failed to parse AI response: ${e.message}`, 'ERROR');
    }

    return { action: 'fail', result: 'Could not parse AI response' };
  }

  async executeAction(decision) {
    const { action, selector, text, key } = decision;

    log(`Executing: ${action} ${selector || text || key || ''}`);

    switch (action) {
      case 'click':
        try {
          if (selector) {
            await this.page.locator(selector).first().click({ timeout: 5000 });
          } else {
            log('No selector provided for click', 'WARN');
          }
        } catch (e) {
          log(`Click failed: ${e.message}`, 'WARN');
          try {
            await this.page.getByRole('button', { name: selector }).click({ timeout: 3000 });
          } catch {
            await this.page.mouse.click(640, 360);
          }
        }
        await randomDelay(500, 1500);
        break;

      case 'type':
        try {
          if (selector) {
            await this.page.locator(selector).first().fill(text || '');
          } else {
            await this.page.keyboard.type(text || '', { delay: 50 });
          }
        } catch (e) {
          log(`Type failed: ${e.message}`, 'WARN');
          await this.page.keyboard.type(text || '', { delay: 50 });
        }
        await randomDelay(300, 800);
        break;

      case 'press':
        await this.page.keyboard.press(key || 'Enter');
        await randomDelay(500, 1500);
        break;

      case 'wait':
        await delay(3000);
        break;

      case 'scroll':
        await this.page.mouse.wheel(0, 500);
        await randomDelay(500, 1000);
        break;

      case 'done':
        log(`Task completed: ${decision.result}`);
        return true;

      case 'fail':
        log(`Task failed: ${decision.result}`, 'ERROR');
        return true;

      default:
        log(`Unknown action: ${action}`, 'WARN');
    }

    return false;
  }

  async run(task) {
    log(`AI Agent starting task: ${task}`);

    for (let step = 0; step < this.maxSteps; step++) {
      log(`\n--- Step ${step + 1}/${this.maxSteps} ---`);

      try {
        const decision = await this.decide(task);
        log(`AI Decision: ${decision.thought || ''}`);
        log(`Action: ${decision.action} ${decision.selector || decision.text || decision.key || ''}`);

        const finished = await this.executeAction(decision);
        if (finished) {
          return decision;
        }

        await delay(1000);

      } catch (error) {
        log(`Error in step ${step + 1}: ${error.message}`, 'ERROR');
        await delay(2000);
      }
    }

    log('Max steps reached', 'WARN');
    return { action: 'fail', result: 'Max steps reached' };
  }
}
