const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
