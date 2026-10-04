import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  webServer: {
    command: 'npm run preview -- --port 4462 --strictPort',
    url: 'http://127.0.0.1:4462',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4462',
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
