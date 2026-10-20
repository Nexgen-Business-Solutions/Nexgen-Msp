import { expect, test } from '@playwright/test';
import { asAdministrator, open } from './helpers';

test.use(asAdministrator);

test('a charge in arrears can still be credited, line by line', async ({ page }) => {
  await open(page, '/msp/billing/BR-2026-10-165');

  await expect(page.getByRole('heading', { level: 1 }).last()).toContainText('BR-2026-10-165');

  await page.getByRole('button', { name: 'Create credit note' }).click();
  await page.waitForLoadState('networkidle');

  await expect(page.getByText('Credit note', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.waitForLoadState('networkidle');

  // the whole charge is offered, with nothing given back until somebody says so
  await expect(page.getByText(/Every line of this charge/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0 selected')).toBeVisible();
  await expect(page.getByText(/Nothing is billable on this window/)).toHaveCount(0);

  const rows = page.locator('label').filter({ hasText: 'SA-' });

  expect(await rows.count()).toBeGreaterThan(0);
  await page.screenshot({ path: '/home/admindev1/shots/r04c-credit-all.png' });
});
