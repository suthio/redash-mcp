import { defineConfig, devices } from '@playwright/test';

// Test environment defaults
const TEST_REDASH_URL = process.env.REDASH_URL || 'https://demo.redash.io';
const TEST_REDASH_API_KEY = process.env.REDASH_API_KEY || 'test_api_key';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  reporter: [
    ['html'],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:6274',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.SKIP_WEBSERVER ? undefined : {
    command: `REDASH_URL=${TEST_REDASH_URL} REDASH_API_KEY=${TEST_REDASH_API_KEY} DANGEROUSLY_OMIT_AUTH=true npm run inspector`,
    url: 'http://localhost:6274',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
