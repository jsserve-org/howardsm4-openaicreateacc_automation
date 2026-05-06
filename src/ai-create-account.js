import dotenv from 'dotenv';
import { createAccount } from './lib/account-creator.js';
import { log } from './utils/helpers.js';

dotenv.config();

async function main() {
  log('=== AI-Powered ChatGPT Account Creator ===');
  log(`Model: ${process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4-20250514'}`);

  try {
    const result = await createAccount({
      headless: process.env.HEADLESS !== 'false',
      onProgress: (step, info) => log(`[${step}] ${info?.email || ''} ${info?.code || ''}`),
      keepOpen: process.env.KEEP_OPEN === 'true',
    });

    log(`Account created: ${result.email}`);
    log(`Session keys: ${Object.keys(result.session || {}).join(', ')}`);
    log(`Final URL: ${result.finalUrl}`);
  } catch (error) {
    log(`Error: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

main().catch((e) => {
  log(`Fatal: ${e.message}`, 'ERROR');
  process.exit(1);
});
