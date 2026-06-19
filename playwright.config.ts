/**
 * Playwright Electron E2E — Vyotiq smoke suite.
 *
 * Uses Playwright's experimental `_electron` API against the electron-vite
 * build output (`out/main/index.js`). See docs/e2e-testing.md.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }]
      ]
    : [
        ['list'],
        ['html', { open: 'on-failure', outputFolder: 'playwright-report' }]
      ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  outputDir: 'test-results'
});
