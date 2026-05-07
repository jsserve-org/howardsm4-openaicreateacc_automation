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

# The Playwright base image ships xvfb. Wrapping the start command in
# `xvfb-run` provides a virtual X display so headful Chromium works inside
# the container — needed when HEADLESS=false (Cloudflare bot detection is
# noticeably looser against headed Chrome than headless).
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x720x24", "npm", "--workspace", "web", "run", "start"]
