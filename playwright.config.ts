import { defineConfig, devices } from '@playwright/test';

// Dedicated ports and data dir so E2E never touches a dev server you are running.
const API_PORT = 8788;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  outputDir: '.playwright/账号体系-20261031/results',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `DATABASE_URL= DATABASE_URL_UNPOOLED= API_PORT=${API_PORT} WEB_PORT=${WEB_PORT} PGLITE_DIR=.data/pglite-e2e-${Date.now()} PASSWORD_HASH= npm run dev`,
    url: `http://localhost:${WEB_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
