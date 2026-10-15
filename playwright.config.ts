import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:1421',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1480, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'npm run preview -- --port 1421',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
