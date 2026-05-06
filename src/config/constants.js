export const SELECTORS = {
  emailInput: 'input[name="email"], input[name="username"], input[type="email"]',
  passwordInput: 'input[name="password"], input[type="password"]',
  continueButton: 'button[type="submit"], button:has-text("Continue"), button:has-text("Next")',
  signupLink: 'a:has-text("Sign up"), a:has-text("Create account"), button:has-text("Sign up")',
  loginLink: 'a:has-text("Log in"), a:has-text("Sign in")',

  verificationCodeInput: 'input[name="code"], input[type="text"], input[autocomplete="one-time-code"]',
  captchaIframe: 'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[title*="captcha"]',

  birthYearSelect: 'select[name="birthYear"]',
  birthMonthSelect: 'select[name="birthMonth"]',
  birthDaySelect: 'select[name="birthDay"]',

  termsCheckbox: 'input[type="checkbox"]',
  agreeButton: 'button:has-text("Agree"), button:has-text("Accept")',

  chatInput: 'textarea#prompt-textarea, textarea[placeholder]',
  newChatButton: 'a:has-text("New chat"), button:has-text("New chat")',
  userProfileButton: 'button[data-testid="profile-button"]',
  logoutButton: 'button:has-text("Log out"), a:has-text("Log out")',
};

export const URLS = {
  chatgpt: 'https://chat.openai.com',
  chatgptAuth: 'https://chat.openai.com/auth/login',
  auth0: 'https://auth0.openai.com',
};

export const TIMEOUTS = {
  navigation: 30000,
  element: 15000,
  verification: 180000,
  captcha: 180000,
};
