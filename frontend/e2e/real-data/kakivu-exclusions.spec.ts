import { expect, test } from '@playwright/test';
import { asAdministrator, open } from '../helpers';

/**
 * Issue #28, read on the company that reported it.
 *
 * This one is outside the standard suite on purpose: it opens a real company's records
 * rather than the fixture's, so it is run when somebody wants to see that case and not on
 * every commit. Nothing is saved or submitted — the screens are read and closed.
 *
 *     npx playwright test e2e/real-data --config playwright.real-data.config.ts
 *
 * No count is written down here. The reported fault was that the two numbers were not
 * explained, so what is checked is that they agree with each other and that every person
 * the difference stands for is named with the reason the server gave. That holds whatever
 * the company's records come to say.
 */

const KAKIVU = 'Kakivu Mousse USD';

test.describe('People, their machines, and the difference explained', () => {
  test.use(asAdministrator);

  test('names who is left out of a Device service and why, before anything is added', async ({
    page,
  }) => {
    await open(page, '/msp/requests/new');

    await page.getByRole('button', { name: /Acting for which customer/ }).click();
    await page.getByRole('listbox').getByPlaceholder('Search…').fill('Kakivu');
    await page.getByRole('option', { name: KAKIVU }).click();

    await page.getByRole('button', { name: /Entire company/ }).click();
    await page.getByRole('button', { name: 'Add entire company' }).click();

    const people = page.locator('tbody tr');

    await expect(people.first()).toBeVisible({ timeout: 30_000 });

    const selected = await people.count();

    expect(selected).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Continue/ }).click();
    await page
      .locator('aside')
      .filter({ hasText: 'Apply actions to' })
      .getByRole('button', { name: /^All selected/ })
      .click();

    const service = page.locator('tbody tr').filter({ hasText: 'Sophos' }).first();
    const said = (await service.innerText()).replace(/\s+/g, ' ');
    const counted = said.match(/(\d+) people selected · (\d+) linked devices/);

    expect(counted, `the service row says what it counted: ${said}`).not.toBeNull();

    const [, onScreen, linked] = counted!;

    expect(Number(onScreen)).toBe(selected);

    const without = selected - Number(linked);

    if (without === 0) {
      await expect(service).not.toContainText('without a linked device');

      return;
    }

    await expect(service).toContainText(
      `${without} ${without === 1 ? 'person' : 'people'} without a linked device`
    );

    await service.getByRole('button', { name: new RegExp(`Why only ${linked}\\?`) }).first().click();

    const why = page.getByRole('dialog');

    await expect(why.getByText(`Why only ${linked}?`)).toBeVisible();

    // every person the difference stands for is named, with the reason the server gave for
    // them rather than a blank or a guess
    const excluded = why.locator('li');

    await expect(excluded).toHaveCount(without);
    await expect(why).toContainText('Person has no current Device.');
    await expect(why).toContainText('NO_CURRENT_DEVICE');
    await expect(why.getByRole('link', { name: 'Devices' })).toBeVisible();

    await why.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
