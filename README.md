# ChatGPT Account Creation Automation

Playwright-based automation for creating ChatGPT accounts with Cloudflare Email Routing for verification codes.

## Architecture

```
ChatGPT Signup -> Sends verification email -> Cloudflare Email Routing -> Worker -> KV Storage
Automation Script -> Polls Worker API -> Gets code -> Enters code -> Account created
```

## Prerequisites

- Node.js >= 18
- Cloudflare account with a domain
- Cloudflare Email Routing enabled on your domain

## Setup

### 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Deploy Cloudflare Worker

```bash
cd cloudflare-worker

# Create KV namespace
npx wrangler kv:namespace create EMAIL_KV
# Copy the id to wrangler.toml

# Update wrangler.toml with your settings
# Set API_TOKEN to a secure random string

# Deploy
npx wrangler deploy
```

### 3. Configure Cloudflare Email Routing

1. Go to Cloudflare Dashboard -> Your Domain -> Email -> Email Routing
2. Enable Email Routing
3. Add a catch-all rule routing to your Worker (`email-receiver`)
4. Note your domain for the `.env` file

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
EMAIL_DOMAIN=yourdomain.com
CLOUDFLARE_WORKER_URL=https://email-receiver.yourdomain.workers.dev
CLOUDFLARE_API_TOKEN=your-secure-api-token
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_KV_NAMESPACE_ID=your-kv-namespace-id
```

## Usage

### Single Account Creation
```bash
npm run create-account
```

### Batch Account Creation
```bash
BATCH_SIZE=5 npm run create-batch
```

### Run Tests
```bash
npm test
npm run test:headed
npm run test:debug
```

## How It Works

1. Script generates a random email on your domain (e.g., `testuser_123_abc@yourdomain.com`)
2. Fills ChatGPT signup form with the email
3. ChatGPT sends a 6-digit verification code to that email
4. Cloudflare Email Routing receives the email and passes it to the Worker
5. Worker extracts the 6-digit code from the email body and stores it in KV
6. Script polls the Worker API until the code is found
7. Script enters the code into ChatGPT's verification form
8. Account is created

## Project Structure

```
├── src/
│   ├── create-account.js      # Single account creation
│   ├── create-batch.js        # Batch creation
│   ├── config/constants.js    # Selectors & URLs
│   └── utils/
│       ├── account-creator.js # Main automation class
│       ├── email-handler.js   # Cloudflare email handler
│       └── helpers.js         # Utilities
├── cloudflare-worker/
│   ├── worker.js              # Email receiving Worker
│   └── wrangler.toml          # Worker config
├── tests/
│   └── account-creation.spec.js
├── playwright.config.js
└── .env.example
```

## Worker API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/get-code?email=x` | GET | Get verification code for email |
| `/get-emails?email=x` | GET | Get all received emails |
| `/clear-emails` | POST | Clear stored emails |
| `/health` | GET | Health check |

## Troubleshooting

### No verification code received
- Check Email Routing is enabled in Cloudflare
- Verify Worker is deployed: `curl https://your-worker.workers.dev/health`
- Check KV namespace ID is correct
- Look at Worker logs: `npx wrangler tail`

### Worker not receiving emails
- Ensure catch-all rule is set to your Worker
- Check MX records are configured for your domain
- Verify domain is active in Cloudflare

### Selectors not matching
OpenAI's UI changes frequently. Update selectors in `src/config/constants.js`.
