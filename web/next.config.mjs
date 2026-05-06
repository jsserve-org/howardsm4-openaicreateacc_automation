import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Account-creation logic lives in ../src and uses Playwright; mark as
  // server-only and let Next bundle it as an external commonjs/esm module.
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  serverExternalPackages: ['playwright', 'playwright-core', '@faker-js/faker'],
  // Allow imports from the parent's src/ tree.
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default nextConfig;
