import { expect, test } from '@playwright/test';
import { as, go, land, openRow, seek } from './ground';
import { GROUP_DROPPED, LAPTOP, MACHINE_SERVICE, PERSONAL_SERVICE } from './names';

/**
 * Phase 7 of the plan — a service taken off the shelf.
 *
 * Withdrawing closes two doors and nothing else: the customer can no longer ask for it, and
 * nobody can hand it out. What already runs keeps running, keeps billing, and can still be
 * stopped — a service nobody may take up must still be one they can put down.
 */

test.describe.configure({ mode: 'serial' });

test.describe('A service is taken off the shelf', () => {
  test.use(as('admin'));

  test('the machine service is removed from MSP, and what runs is kept', async ({ page }) => {
    await land(page);
    await go(page, 'Services');
    await seek(page, MACHINE_SERVICE);

    const row = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();

    await row.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Remove from MSP' }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByText(/Keep existing assignments/)).toBeVisible();
    await dialog.getByRole('button', { name: /^Remove from MSP$/ }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });

    await go(page, 'Services');
    await seek(page, MACHINE_SERVICE);

    const after = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();

    await expect(after).toContainText(/Not available/i);
  });

  test('what was already running is untouched, and still billable', async ({ page }) => {
    await land(page);
    await go(page, 'Devices');
    await openRow(page, LAPTOP);

    const row = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();

    await expect(row, 'the assignment survives the withdrawal').toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(/Active/i);
    await expect(row).toContainText(/Billable/i);
  });

  test('it can still be stopped, because stopping is not taking up', async ({ page }) => {
    await land(page);
    await go(page, 'Devices');
    await openRow(page, LAPTOP);

    const row = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();

    await row.getByRole('button', { name: 'More options' }).click();

    await expect(page.getByRole('menuitem', { name: 'Stop service' })).toBeEnabled();
    await page.keyboard.press('Escape');
  });
});

test.describe('The customer is no longer offered it', () => {
  test.use(as('manager'));

  test('a withdrawn service cannot be asked for any more', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    // somebody who holds neither service, so both would be offered if both were on the shelf
    await page.getByRole('button', { name: /Select existing/ }).click();

    const picker = page.getByRole('dialog');

    await picker.getByLabel('Search').fill(GROUP_DROPPED);
    await picker
      .locator('div')
      .filter({ hasText: GROUP_DROPPED })
      .getByRole('button', { name: /^Add$/ })
      .last()
      .click();
    await picker.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: /Continue/ }).click();

    // wait for the shelf to be read before reading it
    await expect(page.getByText('Reading what can be asked…')).toHaveCount(0, { timeout: 25_000 });
    await expect(page.getByRole('button', { name: /^Add · \d+$/ }).first()).toBeVisible({
      timeout: 25_000,
    });

    const offered = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(offered, 'the withdrawn service is gone from the shelf').not.toContain(MACHINE_SERVICE);
    expect(offered, 'and the one still on it is still there').toContain(PERSONAL_SERVICE);
  });
});

test.describe('And it can be put back', () => {
  test.use(as('admin'));

  test('Make available in MSP reopens on that service, not on an empty search', async ({ page }) => {
    await land(page);
    await go(page, 'Services');
    await seek(page, MACHINE_SERVICE);

    const row = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();

    await row.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Make available in MSP' }).click();

    const dialog = page.getByRole('dialog');

    // the service it was called on is already in the form, which is the whole point: the dialog
    // used to open on an empty search and make you find the row again
    await expect(
      dialog.getByLabel('Name'),
      'the dialog opens on the row it was called from'
    ).toHaveValue(MACHINE_SERVICE, { timeout: 20_000 });

    // left withdrawn on purpose: the billing phase has to prove that a service off the shelf
    // is still billed while it runs, which it cannot prove if this phase puts it back
    await dialog.getByRole('button', { name: /^Cancel$/ }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  });
});
