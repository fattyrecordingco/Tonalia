import { defineConfig } from '@playwright/test';
export default defineConfig({
  timeout: 60000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  outputDir: 'website-test-results',
  use: {
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 1480, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'npm run preview:website',
    url: 'http://127.0.0.1:1430/Tonalia/',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    {
      name: 'website',
      testDir: './tests/website',
      use: { baseURL: 'http://127.0.0.1:1430/Tonalia/' },
    },
    {
      name: 'editor-at-pages-path',
      testDir: './tests/e2e',
      use: { baseURL: 'http://127.0.0.1:1430/Tonalia/app/' },
    },
  ],
  reporter: [['list'], ['html', { outputFolder: 'website-report', open: 'never' }]],
});
