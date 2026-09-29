import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { land } from '../journey/ground';
import { totp } from '../totp';
import { matrix, type Who } from './ground';

export type Window = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  who: Who | null;
  arrived: boolean;
};

const BASE = process.env.MSP_BASE_URL ?? 'http://msp.localhost:8000';

export const test = base.extend<{ window: Window }, { shared: Window }>({
  shared: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({
        baseURL: BASE,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      const window: Window = { browser, context, page, who: null, arrived: false };

      await provide(window);
      await context.close();
    },
    { scope: 'worker' },
  ],
  window: async ({ shared }, provide, testInfo) => {
    await provide(shared);

    if (testInfo.status !== testInfo.expectedStatus) {
      const path = testInfo.outputPath('window.png');

      await shared.page.screenshot({ path, fullPage: true });
      await testInfo.attach('window', { path, contentType: 'image/png' });
    }

    expect(shared.context.pages(), 'one tab, never a second').toHaveLength(1);
    expect(shared.browser.contexts(), 'one window, never a second').toHaveLength(1);
  },
});

export { expect };

const secondsLeft = () => 30 - (Math.floor(Date.now() / 1000) % 30);

const typeCode = async (page: Page, code: string) => {
  const boxes = page.locator('input[autocomplete="one-time-code"]');

  await expect(boxes).toHaveCount(6, { timeout: 20_000 });

  for (let at = 0; at < 6; at += 1) await boxes.nth(at).fill(code[at]);
};

const signOut = async (window: Window) => {
  const page = window.page;

  await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();

  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true });

  await confirm.click();
  await expect(page.getByLabel('Email or username')).toBeVisible({ timeout: 30_000 });
  window.who = null;
};

const passwordStep = async (page: Page, who: Who) => {
  await page.getByLabel('Email or username').fill(matrix[who]);
  await page.getByLabel('Password', { exact: true }).fill(matrix.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};

export const signIn = async (window: Window, who: Who) => {
  const page = window.page;

  if (!window.arrived) {
    await land(page);
    window.arrived = true;
  }

  if (window.who === who) return;
  if (window.who) await signOut(window);

  await expect(page.getByLabel('Email or username')).toBeVisible({ timeout: 30_000 });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await passwordStep(page, who);

    const refused = page.getByRole('alert');
    const code = page.getByText('Enter your code');

    await expect(code.or(refused).first()).toBeVisible({ timeout: 30_000 });

    if (!(await code.isVisible())) {
      await page.waitForTimeout(30_000);
      continue;
    }

    if (secondsLeft() < 3) await page.waitForTimeout(secondsLeft() * 1000 + 500);

    await typeCode(page, totp(matrix[`${who}_secret`]));

    const inside = page.getByRole('navigation').first();

    await expect(inside.or(page.getByRole('alert')).first()).toBeVisible({ timeout: 30_000 });

    if (await inside.isVisible()) {
      await page.waitForLoadState('networkidle');
      window.who = who;

      return;
    }

    await page.waitForTimeout(secondsLeft() * 1000 + 500);

    if (await page.getByLabel('Email or username').isVisible()) continue;

    await typeCode(page, totp(matrix[`${who}_secret`]));
    await expect(inside).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    window.who = who;

    return;
  }

  throw new Error(`${who} could not sign in`);
};
