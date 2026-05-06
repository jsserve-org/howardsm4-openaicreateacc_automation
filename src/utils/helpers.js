import { faker } from '@faker-js/faker';

export function generateEmail(domain = process.env.EMAIL_DOMAIN || 'test.example.com') {
  const timestamp = Date.now();
  const random = faker.string.alphanumeric(6);
  return `testuser_${timestamp}_${random}@${domain}`;
}

export function generatePassword(prefix = process.env.PASSWORD_PREFIX || 'TestPass!') {
  const random = faker.string.alphanumeric(8);
  const special = '!@#$%';
  const specialChar = special[Math.floor(Math.random() * special.length)];
  const number = faker.string.numeric(2);
  return `${prefix}${random}${number}${specialChar}`;
}

export function generateName(prefix = process.env.DEFAULT_NAME_PREFIX || 'TestUser') {
  return `${prefix} ${faker.person.firstName()}`;
}

export function generateBirthDate() {
  const year = faker.number.int({ min: 1980, max: 2000 });
  const month = faker.number.int({ min: 1, max: 12 });
  const day = faker.number.int({ min: 1, max: 28 });
  return { year, month, day };
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(min = 500, max = 2000) {
  const ms = faker.number.int({ min, max });
  return delay(ms);
}

export function formatDate(date) {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

export function log(message, level = 'INFO') {
  const timestamp = formatDate(new Date());
  console.log(`[${timestamp}] [${level}] ${message}`);
}
