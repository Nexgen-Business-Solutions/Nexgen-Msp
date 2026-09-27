import { expect, test } from '@playwright/test';
import { asManager, open, paddingY } from './helpers';

test.use(asManager);

test.describe('A customer raises a request, from the first click to the record', () => {
  test('the whole journey: pick a person, add a change, review, submit', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    // the design asks for one padding on every button, and the browser is what says so
    expect(await paddingY(page.getByRole('button', { name: /Entire company/ }))).toEqual([
      '10px',
      '10px',
    ]);
    await expect(page.getByText('Every selection method feeds the same table.')).toBeVisible();

    await page.getByRole('button', { name: /Select existing/ }).click();
    await page.getByLabel('Search').fill('ZZE2E Alice');
    await page.getByRole('button', { name: /^Add$/ }).first().click();
    await page.getByRole('button', { name: 'Done' }).click();

    const row = page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' });

    await expect(row).toContainText('ZZE2E-PC-ALICE');
    // two services on one person: the cell shows the first and folds the rest, title and all
    await expect(row).toContainText('+ 1 more');
    await expect(row.getByTitle(/ZZE2E Mailbox/).first()).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByText('Group actions stay explicit')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'All selected people' })).toBeVisible();

    await page.getByRole('button', { name: /^End · 1$/ }).first().click();
    await expect(page.getByText('Will apply')).toBeVisible();
    await page.getByRole('button', { name: 'Add action' }).click();

    await expect(page.getByText(/1 target · All selected/)).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Confirm the exact snapshot and requested actions.')).toBeVisible();
    await expect(page.getByText('Concrete targets')).toBeVisible();

    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.waitForURL(/\/msp\/requests/, { timeout: 30_000 });
  });

  test('a whole Department is loaded into the same table', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await page.getByRole('button', { name: /Department/ }).click();
    await page.getByRole('button', { name: 'Select department' }).click();
    await page.getByRole('option', { name: /ZZE2E Finance/ }).click();

    // the count is whatever the Department holds today; what matters is that the table
    // receives exactly the snapshot the preview promised
    const preview = page.getByText(/\d+ active people will be added\./);

    await expect(preview).toBeVisible();

    const promised = Number((await preview.textContent())?.match(/\d+/)?.[0]);

    await page.getByRole('button', { name: 'Load Department' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(promised);
    await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' })).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Bob' })).toHaveCount(1);
  });

  test('the entire company is counted before it is added', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await page.getByRole('button', { name: /Entire company/ }).click();

    // the preview is a promise about the snapshot: what it says is what lands in the table,
    // whatever the company happens to hold today
    const preview = page.getByText(/\d+ active people will be added\./);

    await expect(preview).toBeVisible();

    const promised = Number((await preview.textContent())?.match(/\d+/)?.[0]);

    expect(promised).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Add entire company' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(promised);
  });

  test('the rail narrows the scope and the workspace follows', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await page.getByRole('button', { name: /Entire company/ }).click();
    await page.getByRole('button', { name: 'Add entire company' }).click();
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByRole('heading', { name: 'All selected people' })).toBeVisible();

    await page.getByRole('button', { name: /ZZE2E Finance/ }).first().click();
    await expect(page.getByRole('heading', { name: 'ZZE2E Finance Department' })).toBeVisible();

    await page.getByRole('button', { name: /ZZE2E Carol/ }).first().click();
    await expect(page.getByRole('heading', { name: 'ZZE2E Carol' })).toBeVisible();
  });

});
