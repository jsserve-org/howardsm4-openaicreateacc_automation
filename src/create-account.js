import dotenv from 'dotenv';
import { ChatGPTAccountCreator } from './utils/account-creator.js';
import { log } from './utils/helpers.js';
import fs from 'fs';

dotenv.config();

async function createSingleAccount() {
  log('=== ChatGPT Account Creator ===');
  log('Starting single account creation...');

  const creator = new ChatGPTAccountCreator({
    headless: process.env.HEADLESS !== 'false',
    slowMo: parseInt(process.env.SLOW_MO || '100'),
    proxy: process.env.PROXY_SERVER ? {
      server: process.env.PROXY_SERVER,
      username: process.env.PROXY_USERNAME,
      password: process.env.PROXY_PASSWORD,
    } : null,
  });

  const account = await creator.createAccount({ keepBrowser: false });

  log('\n=== Account Creation Result ===');
  log(`Email: ${account.email}`);
  log(`Password: ${account.password}`);
  log(`Name: ${account.name}`);
  log(`Status: ${account.status}`);

  if (account.error) {
    log(`Error: ${account.error}`, 'ERROR');
  }

  const accountsFile = 'accounts.json';
  let accounts = [];
  if (fs.existsSync(accountsFile)) {
    accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
  }
  accounts.push(account);
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
  log(`Account saved to ${accountsFile}`);

  return account;
}

createSingleAccount().catch(console.error);
