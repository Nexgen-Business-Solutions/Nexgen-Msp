import { expect, test, type Page } from '@playwright/test';
import { acceptEverything, as, go, land, openRow, seek, startWork, submitRequest } from './ground';
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
    await dialog.getByRole('button', { name: 'Add person' }).click();
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

    await theirRow.getByRole('button', { name: 'One that already exists' }).click();
    await page.getByRole('option', { name: 'A new one' }).click();
    await theirRow.getByRole('button', { name: `New device for ${NEWCOMER}` }).click();

    const described = page.getByRole('dialog').filter({ hasText: 'Fill what you have.' });

    await described.getByRole('button', { name: 'Not known yet' }).click();
    await page.getByRole('option', { name: 'Laptop', exact: true }).click();
    await described.getByRole('button', { name: 'Add device' }).click();
    await expect(described).toHaveCount(0, { timeout: 20_000 });
    await expect(theirRow).toContainText('NEW DEVICE');
    await forMachine.getByRole('button', { name: 'Add action' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    await machines.getByRole('button', { name: 'Ask for a Device' }).click();

    const second = page.getByRole('dialog');

    await expect(second.getByLabel(`Include ${NEWCOMER}`)).toBeEnabled();
    await expect(second.getByLabel(`Include ${NEWCOMER}`)).not.toBeChecked();
    await expect(second.getByText('Already asked in this request: New laptop')).toBeVisible();
    await second.getByRole('button', { name: 'Cancel' }).click();
    await expect(second).toHaveCount(0, { timeout: 20_000 });

    await expect(
      page.getByText(/Assign device/).first(),
      'the machine request is on the recap'
    ).toBeVisible();

    await submitRequest(page, 2);
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
    await dialog.getByRole('button', { name: 'Add person' }).click();
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

    await expect(
      page.locator('strong').filter({ hasText: new RegExp(`^Add ${PERSONAL_SERVICE}$`) }),
      'the requested actions carry it once, not twice'
    ).toHaveCount(1);
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
    await startWork(page);

    expect(await acceptEverything(page)).toBe(2);

    // the username came with the request, so the work is never stopped to ask for it
    await expect(
      page.getByRole('button', { name: /Complete \d+ usernames/ }),
      'the username was given when the request was raised'
    ).toHaveCount(0);

    const table = page.getByRole('region', { name: 'Execution workspace' });
    const service = table.locator('tbody tr[data-work-order]').filter({ hasText: `Add ${PERSONAL_SERVICE}` });
    const person = table.locator('tbody tr[data-requested-entity]').filter({ hasText: NEWCOMER });
    const machine = table.locator('tbody tr[data-requested-entity]').filter({ hasText: 'Prepare Device' });

    await page
      .getByRole('complementary', { name: 'Execution view' })
      .getByRole('button', { name: /^All remaining work/ })
      .click();
    await expect(person.getByRole('button', { name: 'Create user' }), 'the person still has to be created').toBeEnabled();
    await expect(machine, 'the Device asked for is work to prepare').toHaveCount(1);
    await expect(
      machine.getByRole('button', { name: 'Prepare Device' }),
      'a machine is not prepared before the person it is for exists'
    ).toBeDisabled();
    await expect(machine).toContainText(`Waits for ${NEWCOMER}`);
    await expect(service.getByRole('button', { name: 'Add service' })).toBeDisabled();
    await expect(service.getByRole('button', { name: 'Prepare person' })).toHaveCount(0);
    await person.getByRole('button', { name: 'Create user' }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('heading', { name: 'Prepare requested Client User' })).toBeVisible();

    // the details the customer gave are already in the form, so nobody types them twice
    await expect(dialog.getByRole('textbox', { name: 'Full name' }), 'the name came with the request').toHaveValue(
      NEWCOMER
    );
    await expect(dialog.getByRole('textbox', { name: 'Username' }), 'and so did the username').toHaveValue(
      NEWCOMER_USERNAME
    );

    await dialog.getByRole('button', { name: 'Save & resolve' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(person).toContainText('Completed');
    await expect(person.getByRole('button', { name: 'Create user' })).toHaveCount(0);
    await expect(machine.getByRole('button', { name: 'Prepare Device' })).toBeEnabled();
    await expect(service).toContainText('Ready');
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
