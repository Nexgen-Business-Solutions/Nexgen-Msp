import { defineConfig, devices } from '@playwright/test';
import { E2E_STATE_DIR } from './e2e/state';

/**
 * The reported cases read on the real companies that reported them.
 *
 * These are kept out of the standard suite because what they open is a customer's own
 * records: run on every commit they would break the day that customer's records change,
 * which is not a fault of the software. They write nothing. The fixture's accounts are
 * still built, because that is what signs in.
 */
export default defineConfig({
  testDir: './e2e/real-data',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: `${E2E_STATE_DIR}/results/real-data`,
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
