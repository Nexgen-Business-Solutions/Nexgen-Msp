import { defineConfig, devices } from '@playwright/test';
import { E2E_STATE_DIR } from './e2e/state';

/** The full journey runs on its own company, built and removed by itself. */
export default defineConfig({
  testDir: './e2e/journey',
  globalSetup: './e2e/journey/setup.ts',
  globalTeardown: './e2e/journey/teardown.ts',
  outputDir: `${E2E_STATE_DIR}/results/journey`,
  workers: 1,
  fullyParallel: false,
  // one company, one walk, in order: a phase that fails leaves the ones after it meaningless,
  // so the run stops there rather than reporting a page of consequences
  maxFailures: 1,
  reporter: [['list']],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.MSP_BASE_URL ?? 'http://msp.localhost:8000',
    // MSP_HEADED=1 opens a real window; MSP_SLOWMO paces the clicks so a person can follow
    headless: process.env.MSP_HEADED !== '1',
    launchOptions: { slowMo: Number(process.env.MSP_SLOWMO ?? 0) },
    viewport: { width: 1440, height: 900 },
    // nothing is recorded unless something fails: a full run of videos fills a disk fast
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } }],
});
