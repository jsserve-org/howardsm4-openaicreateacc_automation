import dotenv from 'dotenv';
import { ChatGPTAccountCreator } from './utils/account-creator.js';
import { log, delay } from './utils/helpers.js';
import fs from 'fs';

dotenv.config();

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '3');
const DELAY_BETWEEN = parseInt(process.env.DELAY_BETWEEN || '30000');

async function createBatchAccounts() {
  log('=== ChatGPT Batch Account Creator ===');
  log(`Batch size: ${BATCH_SIZE}`);
  log(`Delay between accounts: ${DELAY_BETWEEN}ms\n`);

  const accounts = [];
  const accountsFile = 'accounts.json';

  for (let i = 0; i < BATCH_SIZE; i++) {
    log(`\n--- Creating account ${i + 1}/${BATCH_SIZE} ---`);

    const creator = new ChatGPTAccountCreator({
      headless: process.env.HEADLESS !== 'false',
      slowMo: parseInt(process.env.SLOW_MO || '100'),
    });

    const account = await creator.createAccount({ keepBrowser: false });
    accounts.push(account);

    log(`Account ${i + 1} status: ${account.status}`);

    if (i < BATCH_SIZE - 1) {
      log(`Waiting ${DELAY_BETWEEN}ms before next account...`);
      await delay(DELAY_BETWEEN);
    }
  }

  let existingAccounts = [];
  if (fs.existsSync(accountsFile)) {
    existingAccounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
  }
  const allAccounts = [...existingAccounts, ...accounts];
  fs.writeFileSync(accountsFile, JSON.stringify(allAccounts, null, 2));

  log('\n=== Batch Summary ===');
  const successful = accounts.filter(a => a.status === 'created').length;
  const failed = accounts.filter(a => a.status === 'failed').length;
  const captcha = accounts.filter(a => a.status === 'captcha_required').length;

  log(`Total: ${accounts.length}`);
  log(`Created: ${successful}`);
  log(`Failed: ${failed}`);
  log(`CAPTCHA Required: ${captcha}`);
  log(`Results saved to ${accountsFile}`);

  return accounts;
}

createBatchAccounts().catch(console.error);
