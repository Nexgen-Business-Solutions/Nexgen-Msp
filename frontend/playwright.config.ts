import { defineConfig, devices } from '@playwright/test';
import { E2E_STATE_DIR } from './e2e/state';

export default defineConfig({
  testDir: './e2e',
  // the journey has its own config, its own company and its own fixture: run here it would
  // walk a company nobody built
  testIgnore: ['journey/**', 'matrix/**'],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: `${E2E_STATE_DIR}/results/standard`,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.MSP_BASE_URL ?? 'http://msp.localhost:8000',
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
});
