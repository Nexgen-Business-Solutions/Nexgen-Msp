import { defineConfig, devices } from '@playwright/test';
import { E2E_STATE_DIR } from './e2e/state';

export default defineConfig({
  testDir: './e2e/matrix',
  globalSetup: './e2e/matrix/setup.ts',
  globalTeardown: './e2e/matrix/teardown.ts',
  outputDir: `${E2E_STATE_DIR}/results/matrix`,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.MSP_BASE_URL ?? 'http://msp.localhost:8000',
    headless: process.env.MSP_HEADED !== '1',
    launchOptions: { slowMo: Number(process.env.MSP_SLOWMO ?? 0) },
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
});
