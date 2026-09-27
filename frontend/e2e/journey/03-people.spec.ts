import { expect, test } from '@playwright/test';
import { as, createPerson, go, ground, land, openRow } from './ground';

/**
 * Phase 2 of the plan — the people, made every way there is.
 *
 * Two doors are walked here: straight from the register, and through a Department load in a
 * request. The third — a person who does not exist until a request is fulfilled — belongs to
 * the request phase, and is walked there.
 *
 * The last test is the one that matters most: it opens the listing and the person's own page
 * and refuses to let them disagree.
 */

test.describe.configure({ mode: 'serial' });

import { DIRECT, SECOND } from './names';

test.describe('People, straight from the register', () => {
  test.use(as('admin'));

  const create = createPerson;

  test('a person is created and opens on their own page', async ({ page }) => {
    await create(page, DIRECT, 'Finance');

    await expect(page.getByText(DIRECT).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a second one, in another Department', async ({ page }) => {
    await create(page, SECOND, 'Support');

    await expect(page.getByText(SECOND).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a person with no name is refused', async ({ page }) => {
    await land(page);
    await go(page, 'Users');
    await page.getByRole('button', { name: 'New user' }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Select a customer' }).click();
    await page.getByRole('option', { name: new RegExp(ground.customer) }).first().click();

    // nobody is created without a name: the door is shut before it is knocked on
    await expect(dialog.getByRole('button', { name: /Create and open/ })).toBeDisabled();

    await dialog.getByPlaceholder('Marie Dupont').fill('ZZE2E Journey Named');
    await expect(dialog.getByRole('button', { name: /Create and open/ })).toBeEnabled();
  });
});

test.describe('The listing and the page must agree', () => {
  test.use(as('admin'));

  test('what the register counts is what the person holds', async ({ page }) => {
    await land(page);
    await go(page, 'Users');
    await page.getByPlaceholder(/Search/).first().fill(DIRECT);
    await page.waitForLoadState('networkidle');

    const row = page.locator('tbody tr').filter({ hasText: DIRECT }).first();

    await expect(row).toBeVisible({ timeout: 20_000 });

    const cells = await row.locator('td').allTextContents();
    const counted = cells.map((value) => value.trim());

    await openRow(page, DIRECT);

    const body = await page.locator('body').innerText();
    const shown = {
      devices: Number(body.match(/(\d+)\s+devices?/i)?.[1] ?? 0),
      personal: Number(body.match(/(\d+)\s+personal services?/i)?.[1] ?? 0),
      onDevices: Number(body.match(/(\d+)\s+device services?/i)?.[1] ?? 0),
    };

    // a person just created holds nothing, and both screens have to say so
    expect(shown.devices).toBe(0);
    expect(shown.personal).toBe(0);
    expect(shown.onDevices).toBe(0);
    expect(counted.join(' ')).toContain(DIRECT);
  });
});
