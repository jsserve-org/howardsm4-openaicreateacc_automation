# Multi-stage Dockerfile for the web UI + headless Playwright account creator.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS base
WORKDIR /app

# Install Node deps with workspaces.
COPY package.json package-lock.json* ./
COPY web/package.json ./web/package.json
RUN npm install --no-audit --no-fund

# Copy source.
COPY src ./src
COPY web ./web
COPY cloudflare-worker ./cloudflare-worker

# Build the Next.js app.
WORKDIR /app/web
RUN npm run build

# Runtime.
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "--workspace", "web", "run", "start"]
