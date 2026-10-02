import { expect, test, type Page } from '@playwright/test';
import { go, ground, land, openRow, seek } from './ground';
import { totp } from '../totp';

/**
 * The same journey, walked once in a single window so a person can watch it happen.
 *
 * Playwright gives each test its own window, which flickers past too quickly to follow. Here
 * the whole walk is one test, and the role changes by signing in again in the same window —
 * exactly as somebody would who has four accounts and one browser.
 *
 * It runs last, so the company it walks is the one the journey just built, with its people,
 * its machines, its contract, its requests and its disputed invoice all on screen.
 *
 *   MSP_KEEP=1  npx playwright test --config playwright.journey.config.ts
 *   MSP_REUSE=1 MSP_WATCH=1 MSP_HEADED=1 MSP_SLOWMO=550 \
 *     npx playwright test --config playwright.journey.config.ts -g watch --headed
 */

// only when asked for by name: `-g watch`
test.describe('The journey, watched', () => {
  test.skip(!process.env.MSP_WATCH, 'a demonstration, not a check');

  test.setTimeout(15 * 60 * 1000);

  const signInAs = async (page: Page, who: 'admin' | 'technician' | 'manager' | 'operator') => {
    const first = await page.request.post(
      '/api/method/nexgen_msp.api.auth.endpoints.v1.pre_login',
      { form: { username: ground[who], password: ground.password } }
    );

    expect(first.ok(), `password refused for ${who}`).toBeTruthy();

    const pending = (await first.json()).message;
    const second = await page.request.post(
      '/api/method/nexgen_msp.api.auth.endpoints.v1.complete_login',
      {
        form: {
          pending_token: pending.pending_token,
          otp: totp(ground[`${who}_secret`]),
          username: ground[who],
        },
      }
    );

    expect(second.ok(), `code refused for ${who}`).toBeTruthy();
    await land(page);
  };

  const pause = (page: Page, seconds = 1.2) => page.waitForTimeout(seconds * 1000);

  test('watch: one window, four people, every screen reached by clicking', async ({ page }) => {
    await signInAs(page, 'admin');
    await pause(page);

    for (const entry of ['Customers', 'Services', 'Users', 'Devices', 'Billing', 'Activity']) {
      await go(page, entry);
      await pause(page);
    }

    await go(page, 'Customers');
    await page.getByText(ground.customer).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(ground.customer).first()).toBeVisible();
    await pause(page, 2);

    await signInAs(page, 'manager');
    await pause(page);

    await go(page, 'Requests');
    await pause(page);
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await pause(page, 2);

    await page.getByRole('button', { name: /Existing user/ }).click();
    await pause(page, 2);
    await page.getByRole('button', { name: 'Done' }).click();
    await pause(page);

    await signInAs(page, 'operator');
    await go(page, 'Requests');
    await pause(page, 2);

    await signInAs(page, 'technician');

    for (const entry of ['Requests', 'Users', 'Devices']) {
      await go(page, entry);
      await pause(page, 1.6);
    }

    await go(page, 'Users');
    await seek(page, 'ZZE2E Journey Alice');
    await pause(page, 1.6);
    await openRow(page, 'ZZE2E Journey Alice');
    await pause(page, 2.5);

    await go(page, 'Devices');
    await openRow(page, 'ZZE2E-JOURNEY-LT1');
    await pause(page, 2.5);

    await signInAs(page, 'admin');

    await go(page, 'Services');
    await seek(page, 'ZZE2E Journey');
    await pause(page, 2);

    await go(page, 'Billing');
    await pause(page, 1.6);

    // a demonstration, not a check: whatever the journey has already built is shown, and what
    // it has not built yet is simply not opened
    const drawn = page.locator('tbody tr').filter({ hasText: /BR-/ });

    if (await drawn.count()) {
      await openRow(page, /BR-/);
      await pause(page, 3);
    }

    await go(page, 'Customers');
    await openRow(page, ground.customer);
    await pause(page, 3);
  });
});
