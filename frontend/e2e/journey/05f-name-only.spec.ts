import { expect, test } from '@playwright/test';
import { as, go, land } from './ground';

/**
 * A new person added with nothing but a name.
 *
 * The other phases fill a Department and a username on the way in, which is the tidy case. The
 * form says only the full name is required, so this walks the untidy one: type a name, add, and
 * check the person is on the People table and reaches the Actions step like anybody else.
 */

test.describe.configure({ mode: 'serial' });

const ONLY_A_NAME = 'ZZE2E Journey Pierre';

test.describe('Only a name', () => {
  test.use(as('manager'));

  test('a person added with just their name is on the table, and on the next step', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Requests');
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'New user', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Full name').fill(ONLY_A_NAME);
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    // step one: they are on the People table
    await expect(
      page.locator('tbody tr').filter({ hasText: ONLY_A_NAME }),
      'a person with only a name is still a person'
    ).toHaveCount(1);

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });

    // step two: they are in the rail on the left, which is an aside and not a navigation
    await expect(
      page.getByRole('button', { name: new RegExp(ONLY_A_NAME) }).first(),
      'and they are on the Actions step too'
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('Reading what can be asked…')).toHaveCount(0, { timeout: 25_000 });

    const offered = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(offered, 'something can be asked for them').toMatch(/Add · \d+/);
  });
});
