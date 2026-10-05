import { defineConfig, devices } from '@playwright/test';

// Uses the locally installed Chrome (no browser download). Requires a local mongod and built
// apps (`npm run build`).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4100',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'node tests/e2e/start-server.js',
    url: 'http://127.0.0.1:4100/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
