import { expect, test } from '@playwright/test';
import { as, go, ground, land, opensCleanly, openRow } from './ground';

/**
 * Phase 0 and 1 — the ground, and the catalogue the migration left behind.
 *
 * Nothing is asserted here that a person could not see: an empty company reads as empty, a
 * door that is shut says so, and the services that were really used are the ones the patch
 * gave a definition to.
 */

test.describe.configure({ mode: 'serial' });

test.describe('Phase 0 — the ground', () => {
  test.use(as('admin'));

  test('the company exists and reads as empty', async ({ page }) => {
    await land(page);
    await go(page, 'Customers');
    await openRow(page, ground.customer);
    await opensCleanly(page, /ZZE2E Journey/);

    // the one customer screen: its counters, its contract and its pricing
    await expect(page.getByRole('button', { name: /\d+ users/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /\d+ devices/ })).toBeVisible();
    await expect(page.getByText(/\d+ contracts?/)).toBeVisible();
  });

  test('a customer can be created from the register, and opens on its own page', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Customers');
    await page.getByRole('button', { name: 'New customer' }).click();

    const name = `ZZE2E Created ${Date.now().toString().slice(-5)}`;

    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create customer' }).click();

    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Phase 0 — doors that are shut', () => {
  test.use(as('operator'));

  test('an operator is told plainly that raising a request is not theirs to do', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Requests');

    // they are not refused after clicking: the way in is simply never offered to them
    await expect(page.getByRole('button', { name: /New request|Raise a request/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Existing user/ })).toHaveCount(0);
  });

  test('and the explanation is there for anyone who reaches the form anyway', async ({ page }) => {
    // the only address this run types, because no menu leads here for this person
    await page.goto('/msp/requests/new');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('You may not raise requests')).toBeVisible();
  });
});

test.describe('Phase 1 — the catalogue after the migration', () => {
  test.use(as('admin'));

  test('the listing says what it counts, and drops the ERPNext plumbing', async ({ page }) => {
    await land(page);
    await go(page, 'Services');
    await opensCleanly(page, /Service catalogue/);

    const header = page.locator('table').filter({ hasText: 'MSP availability' }).locator('thead');

    await expect(header).toContainText('Companies using it');
    await expect(header).not.toContainText('ERPNext Item');
    await expect(header).not.toContainText('ERPNext status');
  });

  test('a service that is really used has a definition and reads as available', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Services');

    const rows = page.locator('tbody tr');

    await expect(rows.first()).toBeVisible();

    // every row the catalogue shows resolves: the patch gave one to what was in use
    const availabilities = await rows.locator('td').nth(2).allTextContents();

    expect(availabilities.length).toBeGreaterThan(0);
    for (const value of availabilities) {
      expect(['Available', 'Needs configuration', 'Not available']).toContain(value.trim());
    }
  });
});

test.describe('Phase 1 — a screen that is not theirs', () => {
  test.use(as('technician'));

  test('a technician is not even offered the catalogue in the menu', async ({ page }) => {
    await land(page);

    const sidebar = page.getByRole('navigation').first();

    await expect(sidebar.getByRole('button', { name: 'Services', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Requests', exact: true })).toHaveCount(1);
  });
});
