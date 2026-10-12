// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// End-to-end suite. Normally run inside docker-compose.e2e.yml (see
// TESTING.md), where the browser reaches the stack by service name:
//   web http://web:3001 · api http://api:4000 · Mailpit http://mailpit:8025
// Against a stack you started yourself, override with E2E_BASE_URL,
// E2E_API_URL, MAILPIT_URL and E2E_SITE_URL.
module.exports = defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one browser, one IP: keeps the API's per-IP limits predictable
  retries: 0, // a flaky E2E test is a bug to fix, not to retry away
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
