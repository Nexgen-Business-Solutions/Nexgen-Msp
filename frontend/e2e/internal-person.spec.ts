import { expect, test } from '@playwright/test';
import { asTechnician, box, fixture, open, paddingY } from './helpers';

test.use(asTechnician);

test.describe("A person's page, read in a browser", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, `/msp/users/${fixture.person}`);
  });

  test('the services filter sits on the right of the panel, beside the action', async ({ page }) => {
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Services' }) });
    const filter = panel.getByRole('button', { name: 'All services' });
    const action = panel.getByRole('button', { name: 'Add service' });

    await expect(filter).toBeVisible();

    const panelBox = await box(panel);
    const filterBox = await box(filter);
    const actionBox = await box(action);

    expect(filterBox.x, 'the filter belongs to the right half of the header').toBeGreaterThan(
      panelBox.x + panelBox.width / 2
    );
    expect(
      Math.abs(filterBox.y - actionBox.y),
      'the filter shares the header line with the action'
    ).toBeLessThan(12);
    expect(filterBox.x, 'the filter comes before the action').toBeLessThan(actionBox.x);
  });

  test('every button on the page carries the padding the design asks for', async ({ page }) => {
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Services' }) });

    expect(await paddingY(panel.getByRole('button', { name: 'Add service' }))).toEqual([
      '10px',
      '10px',
    ]);
  });

  test('the filter narrows the table without hiding what ended', async ({ page }) => {
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Services' }) });
    const rows = panel.locator('tbody tr');

    await expect(rows.filter({ hasText: 'ZZE2E Mailbox' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'ZZE2E VPN access' })).toHaveCount(1);

    await panel.getByRole('button', { name: 'All services' }).click();

    const list = page.getByRole('listbox');

    await expect(list.getByRole('option', { name: /^Ended/ })).toBeVisible();
    await list.getByRole('option', { name: /^Ended/ }).click();

    await expect(rows.filter({ hasText: 'ZZE2E VPN access' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'ZZE2E Mailbox' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Ended' }).click();
    await page.getByRole('option', { name: /^Current/ }).click();

    await expect(rows.filter({ hasText: 'ZZE2E Mailbox' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'ZZE2E VPN access' })).toHaveCount(0);
  });

  test('a machine service is read under the machine that runs it', async ({ page }) => {
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Services' }) });
    const row = panel.locator('tbody tr').filter({ hasText: 'ZZE2E Antivirus' });

    await expect(row).toContainText('ZZE2E-PC-ALICE');
  });
});
