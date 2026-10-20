import { expect, test } from '@playwright/test';
import { asAdministrator, open } from './helpers';

test.use(asAdministrator);

test('the billing page is the R04 workspace', async ({ page }) => {
  await open(page, '/msp/billing');

  await expect(page.getByText('Review upcoming billing and track invoices.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record past coverage' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New billing run' })).toBeVisible();
  await expect(page.getByText('Invoiced total')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Ready to bill' })).toBeVisible();
  for (const column of ['What', 'Customer / contract', 'Period', 'Lines', 'Estimated amount', 'Status']) {
    await expect(page.getByRole('columnheader', { name: column, exact: true }).first()).toBeVisible();
  }

  await page.screenshot({ path: '/home/admindev1/shots/r04b-billing.png', fullPage: true });

  await page.getByRole('button', { name: /^Sales invoices/ }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('columnheader', { name: 'Posting / due date' })).toBeVisible();
  await page.screenshot({ path: '/home/admindev1/shots/r04b-invoices.png' });
});

test('a run reads as a record with four states', async ({ page }) => {
  await open(page, '/msp/billing');

  await page.getByRole('row').filter({ hasText: /^BR-/ }).first().click();
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { level: 1 }).last()).toContainText('BR-');
  await expect(page.getByText('Billing lines', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Run details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

  await page.screenshot({ path: '/home/admindev1/shots/r04b-run.png', fullPage: true });
});

test('the wizard prepares every operation in four steps', async ({ page }) => {
  await open(page, '/msp/billing');
  await page.getByRole('button', { name: 'New billing run' }).click();
  await page.waitForLoadState('networkidle');

  const main = page.getByRole('main');

  for (const step of ['Context', 'Services', 'Accounting', 'Confirm']) {
    await expect(main.getByText(step, { exact: true }).first()).toBeVisible();
  }

  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select a contract' })).toBeVisible();

  // the three operations are one path, not three screens
  await page.getByRole('button', { name: 'Regular billing' }).first().click();
  for (const kind of ['Regular billing', 'Additions', 'Credit note']) {
    await expect(page.getByRole('option', { name: kind })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');

  await page.screenshot({ path: '/home/admindev1/shots/r04b-wizard.png' });
});
