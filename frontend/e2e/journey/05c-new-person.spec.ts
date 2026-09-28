import { expect, test, type Page } from '@playwright/test';
import { as, go, land, openRow, seek } from './ground';
import { NEWCOMER, NEWCOMER_USERNAME, PERSONAL_SERVICE } from './names';

/**
 * A person who does not exist yet, asked for with the username they will use.
 *
 * The third door into the register: the customer names somebody who is not on file, says what
 * they will be called on the service, and the technician creates them while doing the work.
 *
 * The username is the point of this phase. Given here, it travels with the request, so the
 * work runs without stopping to ask for it a second time — which is what `Complete N usernames`
 * exists for when it was never given.
 */

test.describe.configure({ mode: 'serial' });

const DEPARTMENT = 'Logistics';

test.describe('The customer asks for somebody who is not on file', () => {
  test.use(as('manager'));

  test('a new person is named, with the username they will use', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'New user', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Full name').fill(NEWCOMER);
    await dialog.getByRole('button', { name: /No Department yet|Department/ }).first().click();
    await page.getByRole('option', { name: new RegExp(DEPARTMENT) }).first().click();
    await dialog.getByLabel('Username').fill(NEWCOMER_USERNAME);
    await dialog.getByRole('button', { name: 'Add to request' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await expect(page.locator('tbody tr').filter({ hasText: NEWCOMER })).toHaveCount(1);

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });

    const row = page
      .locator('tbody tr')
      .filter({ hasText: PERSONAL_SERVICE })
      .filter({ hasText: /Add · \d+/ })
      .last();

    await row.getByRole('button', { name: /^Add · \d+$/ }).click();

    const impact = page.getByRole('dialog');

    await expect(impact.getByText(/\d+ of \d+ people are applicable/)).toBeVisible({
      timeout: 20_000,
    });
    await impact.getByRole('button', { name: 'Add action' }).click();
    await expect(impact).toHaveCount(0, { timeout: 20_000 });

    // a new joiner needs a machine as well, and asking for one is its own act: every other
    // machine act starts from a machine they already hold, which they do not
    const machines = page
      .locator('tbody tr')
      .filter({ hasText: 'Give a Device' })
      .first();

    await expect(machines, 'a Device can be asked for somebody who holds none').toBeVisible({
      timeout: 20_000,
    });
    await machines.getByRole('button', { name: 'Ask for a Device' }).click();

    const forMachine = page.getByRole('dialog');

    await expect(forMachine.getByText(/hold no Device/)).toBeVisible({ timeout: 20_000 });
    await expect(forMachine.getByLabel(`Include ${NEWCOMER}`)).toBeChecked();

    // described rather than picked, and none of it required
    const theirRow = forMachine.locator('tbody tr').filter({ hasText: NEWCOMER }).first();

    await theirRow.getByRole('button', { name: 'One already on file' }).click();
    await page.getByRole('option', { name: 'A new one' }).click();
    await forMachine.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Laptop', exact: true }).click();
    await forMachine.getByRole('button', { name: 'Add action' }).click();
    await expect(forMachine).toHaveCount(0, { timeout: 20_000 });

    // a second machine for the same person: asking twice is two machines, not a duplicate
    await machines.getByRole('button', { name: 'Ask for a Device' }).click();

    const second = page.getByRole('dialog');

    await expect(second.getByLabel(`Include ${NEWCOMER}`)).toBeEnabled();
    await second.getByRole('button', { name: 'Add action' }).click();
    await expect(second).toHaveCount(0, { timeout: 20_000 });

    await expect(
      page.getByText(/Assign device/).first(),
      'both machine requests are on the recap'
    ).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByText('Confirm the exact snapshot and requested actions.')).toBeVisible();
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.waitForURL(
      (url) => /\/msp\/requests/.test(url.pathname) && !url.pathname.endsWith('/new'),
      { timeout: 30_000 }
    );
  });
});

test.describe('And the same act cannot be asked for twice', () => {
  test.use(as('manager'));

  test('once added, the action says so and cannot be added again', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'New user', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('Full name').fill(`${NEWCOMER} Twin`);
    await dialog.getByRole('button', { name: 'Add to request' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });

    const row = page
      .locator('tbody tr')
      .filter({ hasText: PERSONAL_SERVICE })
      .filter({ hasText: /Add · \d+/ })
      .last();

    const add = row.getByRole('button', { name: /^Add · \d+$/ });

    await add.click();

    const impact = page.getByRole('dialog');

    await impact.getByRole('button', { name: 'Add action' }).click();
    await expect(impact).toHaveCount(0, { timeout: 20_000 });

    // the row now says it, and the button is shut: one wish, one line
    await expect(row.getByText(/asked/i).first(), 'the row says it is already asked for').toBeVisible(
      { timeout: 20_000 }
    );
    await expect(add, 'and it cannot be added a second time').toBeDisabled();

    const recap = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const asked = recap.match(new RegExp(`Add ${PERSONAL_SERVICE}`, 'g')) ?? [];

    expect(asked.length, 'the recap carries it once, not twice').toBeLessThanOrEqual(1);
  });
});

test.describe('Nexgen creates them while doing the work', () => {
  test.use(as('technician'));

  const openLatest = async (page: Page) => {
    await land(page);
    await go(page, 'Requests');
    await openRow(page, NEWCOMER);
  };

  test('the person is created from the request, and the work needs no second ask', async ({
    page,
  }) => {
    await openLatest(page);

    const accept = page.getByRole('button', { name: /^Accept all( pending| \d+)$/ }).first();

    await expect(accept).toBeVisible({ timeout: 25_000 });
    await accept.click();
    await expect(page.getByText('Line review complete')).toBeVisible({ timeout: 25_000 });
    await page.getByRole('button', { name: 'Continue to Execute' }).click();
    await page.waitForLoadState('networkidle');

    // the username came with the request, so the work is never stopped to ask for it
    await expect(
      page.getByRole('button', { name: /Complete \d+ usernames/ }),
      'the username was given when the request was raised'
    ).toHaveCount(0);

    // and the machine they asked for is on the preparation list, not invented as a service
    await expect(
      page.getByRole('button', { name: /Prepare \d+ Devices/ }),
      'the Device asked for is work to prepare'
    ).toBeVisible({ timeout: 25_000 });

    const create = page.getByRole('button', { name: /Create \d+ Client Users/ });

    await expect(create, 'the person still has to be created').toBeVisible({ timeout: 25_000 });
    await create.click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // the people still to create are listed: pick the one this request is for
    await dialog.getByRole('button', { name: new RegExp(NEWCOMER) }).first().click();

    // the details the customer gave are already in the form, so nobody types them twice
    await expect(
      dialog.getByLabel(`Full name for ${NEWCOMER}`),
      'the name came with the request'
    ).toHaveValue(NEWCOMER, { timeout: 20_000 });
    await expect(
      dialog.getByLabel(`Username for ${NEWCOMER}`),
      'and so did the username'
    ).toHaveValue(NEWCOMER_USERNAME, { timeout: 20_000 });

    await dialog.getByRole('button', { name: 'Create this person' }).click();
    await expect(dialog.getByText('1 of 1 completed')).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  });

  test('and the username they were asked for is the one they hold', async ({ page }) => {
    await land(page);
    await go(page, 'Users');
    await seek(page, NEWCOMER);
    await openRow(page, NEWCOMER);

    await expect(page.getByRole('heading', { name: NEWCOMER }).first()).toBeVisible({
      timeout: 25_000,
    });

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(body, 'the username travelled from the request to the person').toContain(
      NEWCOMER_USERNAME
    );
  });
});
