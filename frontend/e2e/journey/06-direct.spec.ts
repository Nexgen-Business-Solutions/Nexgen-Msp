import { expect, test, type Page } from '@playwright/test';
import { as, createPerson, dayOfThisMonth, go, land, openRow, seek } from './ground';
import {
  DIRECT,
  LAPTOP,
  LATECOMER,
  MACHINE_SERVICE,
  PAUSED,
  PERSONAL_SERVICE,
  OUTSIDE,
  STOPPED,
  UNBILLED,
} from './names';

/**
 * Phase 6 of the plan — the things nobody asked for.
 *
 * A technician suspends, resumes, stops and adds outside any request, which is what the `⋯`
 * menus are for. The five cases the billing phase needs are arranged here deliberately, each
 * on its own person, so a wrong line has exactly one thing it can be blamed on.
 */

test.describe.configure({ mode: 'serial' });

/** The personal service, handed to somebody from their own page rather than through a request. */
const addPersonalService = async (page: Page, person: string, from?: string) => {
  await land(page);
  await go(page, 'Users');
  await openRow(page, person);
  await page.getByRole('button', { name: 'Add service' }).first().click();

  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Select a service' }).click();
  await page.getByRole('option', { name: new RegExp(PERSONAL_SERVICE) }).first().click();

  if (from) await dialog.locator('input[type="date"]').first().fill(from);

  // the service is identified by the username the person uses on it, so it is asked for here
  const username = dialog.getByPlaceholder(/The username they use on this service/);

  if (await username.count()) {
    await username.fill(person.toLowerCase().replace(/[^a-z]+/g, '.'));
  }

  await dialog.getByRole('button', { name: 'Activate service' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByText(new RegExp(PERSONAL_SERVICE)).first()).toBeVisible({
    timeout: 20_000,
  });
};

/** Act on a service the way a technician does: from the row's own menu. */
const actOnService = async (
  page: Page,
  service: string,
  action: 'Suspend' | 'Resume' | 'Stop service',
  on: string,
  note?: string
) => {
  const row = page.locator('tbody tr').filter({ hasText: service }).first();

  await expect(row, `no ${service} row to act on`).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: action }).click();

  const dialog = page.getByRole('dialog');

  await dialog.locator('input[type="date"]').first().fill(on);

  // the note holds what was typed and nothing else: no sentence is written on anyone's behalf
  if (note) await dialog.getByLabel('Internal note').fill(note);

  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 25_000 });
};

test.describe('Beside the request, the technician acts', () => {
  test.use(as('technician'));

  test('a service is added outside any request, and reads as active', async ({ page }) => {
    // their own person: everybody who came through a request already holds this service, and
    // asking for the same thing twice is refused on purpose
    await createPerson(page, OUTSIDE, 'Finance');
    await addPersonalService(page, OUTSIDE, dayOfThisMonth(1));

    await expect(page.getByText(/Active/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a person nobody gave anything to stays empty', async ({ page }) => {
    await createPerson(page, UNBILLED, 'Finance');

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(body, 'no service was invented for them').not.toContain(PERSONAL_SERVICE);
  });

  test('a machine gets a service of its own from the row it sits on', async ({ page }) => {
    await land(page);
    await go(page, 'Devices');
    await openRow(page, LAPTOP);
    await page.getByRole('button', { name: /Add service/ }).first().click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Select a service' }).click();
    await page.getByRole('option', { name: new RegExp(MACHINE_SERVICE) }).first().click();
    await dialog.getByRole('button', { name: /Activate service|Add service/ }).first().click();

    await expect(dialog).toHaveCount(0, { timeout: 25_000 });
    await expect(page.getByText(new RegExp(MACHINE_SERVICE)).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('The five shapes the billing run has to tell apart', () => {
  // an administrator, because arranging periods that are already behind us is theirs to do:
  // the application refuses a technician ending a service on a past date, and it is right to
  test.use(as('admin'));

  test('one is paused in the middle of the period, then picked back up', async ({ page }) => {
    await createPerson(page, PAUSED, 'Support');
    await addPersonalService(page, PAUSED, dayOfThisMonth(1));

    await actOnService(page, PERSONAL_SERVICE, 'Suspend', dayOfThisMonth(10), 'machine away');
    await expect(page.getByText(/Suspended/i).first()).toBeVisible({ timeout: 20_000 });

    await actOnService(page, PERSONAL_SERVICE, 'Resume', dayOfThisMonth(20));
    await expect(page.getByText(/Active/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('one is stopped in the middle of the period, and stays on the record', async ({ page }) => {
    await createPerson(page, STOPPED, 'Support');
    await addPersonalService(page, STOPPED, dayOfThisMonth(1));

    await actOnService(page, PERSONAL_SERVICE, 'Stop service', dayOfThisMonth(15), 'left the company');

    // what ended is history, not a hole: the row is still there, and it says when it closed
    await expect(page.getByText(/Ended/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(new RegExp(PERSONAL_SERVICE)).first()).toBeVisible();
  });

  test('one only opens in the middle of the period', async ({ page }) => {
    await createPerson(page, LATECOMER, 'Finance');
    await addPersonalService(page, LATECOMER, dayOfThisMonth(16));

    await expect(page.getByText(/Active/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the register agrees with each of them', async ({ page }) => {
    await land(page);
    await go(page, 'Users');

    for (const person of [DIRECT, OUTSIDE, PAUSED, STOPPED, LATECOMER, UNBILLED]) {
      await seek(page, person);
    }
  });
});

test.describe('What the notes may and may not say', () => {
  test.use(as('technician'));

  test('a note holds what was typed, and nothing was written on anybody else behalf', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Users');
    await openRow(page, PAUSED);

    // their page, not the register it was opened from: read it once it is actually there
    await expect(page.getByRole('heading', { name: PAUSED }).first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole('heading', { name: 'Internal notes' })).toBeVisible({
      timeout: 25_000,
    });

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(body, 'the note that was typed is kept').toContain('machine away');
    expect(body, 'and no sentence was generated for it').not.toMatch(
      /Suspended on \d{4}-\d{2}-\d{2}|Service suspended by/
    );
  });
});
