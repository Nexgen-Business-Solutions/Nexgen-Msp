import { expect, test } from '@playwright/test';
import { as, dayOfThisMonth, go, ground, land, opensCleanly, openRow } from './ground';
import { MACHINE_SERVICE, PERSONAL_SERVICE } from './names';

/**
 * Phase 2 — what Nexgen sells this company, and for how much.
 *
 * Both services are made here, through the screens: one for people, one for machines. Then
 * the contract that lets this company ask for them, and the rate each one is billed at.
 */

test.describe.configure({ mode: 'serial' });
test.use(as('admin'));

const PERSONAL = 'ZZE2E-JS-MAIL';
const MACHINE = 'ZZE2E-JS-AV';

const createService = async (
  page: import('@playwright/test').Page,
  code: string,
  label: string,
  scope: 'User' | 'Device'
) => {
  await land(page);
  await go(page, 'Services');
  await page.getByRole('button', { name: /Add service/ }).first().click();
  await page.getByText('Create new Item').click();

  await page.getByLabel('Service code').fill(code);
  await page.getByLabel('Name', { exact: true }).fill(label);

  await page.getByRole('button', { name: 'Select a scope' }).click();
  // an option carries its explanation in its accessible name, so it is matched by its start
  await page.getByRole('option', { name: new RegExp(`^${scope}`) }).click();

  await page.getByRole('button', { name: /Create service/ }).click();

  // the dialog closes when it worked; when it did not, it says why and the run repeats it
  const dialog = page.getByRole('dialog');

  await expect
    .poll(async () => ((await dialog.count()) ? (await dialog.innerText()).slice(0, 400) : 'closed'), {
      timeout: 20_000,
    })
    .toBe('closed');
};

test.describe('Phase 2 — the services', () => {
  test('a service for people is created from the catalogue', async ({ page }) => {
    await createService(page, PERSONAL, 'ZZE2E Journey Mailbox', 'User');

    await go(page, 'Services');
    await expect(page.getByText('ZZE2E Journey Mailbox').first()).toBeVisible({ timeout: 20_000 });
  });

  test('a service for machines is created the same way', async ({ page }) => {
    await createService(page, MACHINE, 'ZZE2E Journey Antivirus', 'Device');

    await go(page, 'Services');
    await expect(page.getByText('ZZE2E Journey Antivirus').first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('each one opens on its own page and says what it is', async ({ page }) => {
    await land(page);
    await go(page, 'Services');
    await page.getByText('ZZE2E Journey Mailbox').first().click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/User/).first()).toBeVisible();
  });
});

test.describe('Phase 2 — the contract and its rates', () => {
  test('the company gets a contract', async ({ page }) => {
    await land(page);
    await go(page, 'Customers');
    await openRow(page, ground.customer);
    await opensCleanly(page, /ZZE2E Journey/);
    await page.getByRole('button', { name: 'New contract' }).click();

    await page.getByLabel('Title').fill('ZZE2E Journey contract');

    // from the first of the month, so a period billed over this month is inside the contract:
    // a run cannot start before the contract it bills under
    await page.getByLabel('Start date').fill(dayOfThisMonth(1));

    const dialog = page.getByRole('dialog');

    /**
     * The terms the later phases depend on.
     *
     * These used to be set in a loop that skipped anything it could not find, which meant a
     * contract could be created without the proration method the billing phase exists to
     * check — and the run would go on and bill full months without ever saying why. A field
     * that is required here is required: if it is not on the form, this fails.
     */
    const required = [
      ['Status', /^Active/],
      ['Billing frequency', /^Month/],
      // days actually consumed: a pause, an end and a late start must not all bill a month
      ['Proration', /Daily Actual Days/],
    ] as const;

    const optional = [
      ['Billing timing', /Arrears|Advance/],
      ['Invoice grouping', /./],
      ['Price list', /Selling|Standard|./],
    ] as const;

    const control = (label: string) =>
      dialog
        .locator('div')
        .filter({ hasText: new RegExp(`^${label}`) })
        .getByRole('button')
        .first();

    for (const [label, option] of required) {
      const field = control(label);

      await expect(field, `the contract form has no ${label}`).toBeVisible({ timeout: 20_000 });
      await field.click();

      const choice = page.getByRole('option', { name: option }).first();

      await expect(choice, `${label} does not offer ${option}`).toBeVisible({ timeout: 20_000 });
      await choice.click();

      // and it holds what was chosen, rather than closing on nothing
      await expect(control(label), `${label} did not keep what was chosen`).toHaveText(option);
    }

    for (const [label, option] of optional) {
      const field = control(label);

      if (!(await field.count())) continue;

      await field.click();

      const choice = page.getByRole('option', { name: option }).first();

      if (await choice.count()) await choice.click();
      else await page.keyboard.press('Escape');
    }

    // the services the contract covers: a rate alone does not make a service orderable, the
    // contract saying it covers it does
    await dialog.getByRole('button', { name: /Select the services this contract covers/ }).click();

    for (const service of [PERSONAL_SERVICE, MACHINE_SERVICE]) {
      await page.getByRole('option', { name: new RegExp(service) }).first().click();
    }

    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Save contract/ }).click();

    await expect
      .poll(async () => ((await dialog.count()) ? 'open' : 'closed'), { timeout: 20_000 })
      .toBe('closed');

    await expect(page.getByText('ZZE2E Journey contract').first()).toBeVisible({ timeout: 20_000 });

  });

  test('each service is given a rate on that contract', async ({ page }) => {
    for (const [label, rate] of [
      ['ZZE2E Journey Mailbox', '12'],
      ['ZZE2E Journey Antivirus', '8'],
    ] as const) {
      await land(page);
      await go(page, 'Customers');
      await openRow(page, ground.customer);
      await page.getByRole('button', { name: /New rate|Add rate/ }).first().click();

      const dialog = page.getByRole('dialog');

      await dialog.getByRole('button', { name: /Choose|Select|Service/ }).first().click();
      await page.getByRole('option', { name: new RegExp(label) }).first().click();
      await page.getByLabel('Rate', { exact: true }).fill(rate);
      await dialog.getByRole('button', { name: /Save|Add/ }).last().click();

      // if it refuses, the run repeats the refusal rather than saying "still open"
      await expect
        .poll(
          async () =>
            (await dialog.count()) ? (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 300) : 'closed',
          { timeout: 20_000 }
        )
        .toBe('closed');
    }

    await expect(page.getByText('ZZE2E Journey Mailbox').first()).toBeVisible({ timeout: 20_000 });
  });
});
