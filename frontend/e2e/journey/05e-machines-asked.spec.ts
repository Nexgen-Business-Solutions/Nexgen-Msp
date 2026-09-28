import { expect, test, type Page } from '@playwright/test';
import { as, createPerson, go, land, openRow, runReadyWork, seek } from './ground';
import { MACHINE_ASKER, MACHINE_KEEPER, MACHINE_SERVICE } from './names';

/**
 * Phase 5e — machines asked for, and machines taken back.
 *
 * A request has to be able to say both things. Giving somebody a machine was not askable at
 * all until now; taking one back was, but nothing in the run ever walked it. Both are here,
 * on their own people, with the accord of the company in between — because the person who
 * raises these is not the person who decides on them.
 */

test.describe.configure({ mode: 'serial' });

const DEPARTMENT = 'Logistics';

const addExisting = async (page: Page, person: string) => {
  await page.getByRole('button', { name: /Select existing/ }).click();

  const picker = page.getByRole('dialog');

  await picker.getByLabel('Search').fill(person);
  await picker
    .locator('div')
    .filter({ hasText: person })
    .getByRole('button', { name: /^Add$/ })
    .last()
    .click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toHaveCount(0, { timeout: 20_000 });
};

const startRequest = async (page: Page, person: string) => {
  await land(page);
  await go(page, 'Requests');
  await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
  await page.waitForLoadState('networkidle');
  await addExisting(page, person);
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });
};

const submit = async (page: Page) => {
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByText('Confirm the exact snapshot and requested actions.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await page.waitForURL(
      (url) => /\/msp\/requests/.test(url.pathname) && !url.pathname.endsWith('/new'),
      { timeout: 30_000 }
    );
};

/** Agree to it as the company, so it reaches Nexgen at all. */
const approve = async (page: Page) => {
  await land(page);
  await go(page, 'Requests');
  await openRow(page, /SR-/);
  await page.getByRole('button', { name: /Approve and send to Nexgen/ }).click();
  await expect(page.getByText(/AWAITING CUSTOMER APPROVAL/i)).toHaveCount(0, { timeout: 30_000 });
};

test.describe('Two people for the machine story', () => {
  test.use(as('admin'));

  test('one who will be given a machine, one who already holds one', async ({ page }) => {
    for (const person of [MACHINE_ASKER, MACHINE_KEEPER]) {
      await createPerson(page, person, DEPARTMENT);
      await expect(page.getByText(person).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});

test.describe('A machine is asked for, and the company agrees', () => {
  test('the requester asks, the approver agrees, the technician prepares it', async ({
    browser,
  }) => {
    const asking = await browser.newContext(as('requester'));
    const askingPage = await asking.newPage();

    await startRequest(askingPage, MACHINE_ASKER);

    const row = askingPage
      .locator('tbody tr')
      .filter({ hasText: 'Give a Device' })
      .first();

    await expect(row, 'giving a machine is something a customer can ask for').toBeVisible({
      timeout: 20_000,
    });
    await row.getByRole('button', { name: 'Ask for a Device' }).click();

    const dialog = askingPage.getByRole('dialog');
    const theirs = dialog.locator('tbody tr').filter({ hasText: MACHINE_ASKER }).first();

    // they know what they want, roughly: none of it is required
    await theirs.getByRole('button', { name: 'One already on file' }).click();
    await askingPage.getByRole('option', { name: 'A new one' }).click();
    await dialog.getByLabel(`Hostname for ${MACHINE_ASKER}`).fill('ZZE2E-ASKED-01');
    await dialog.getByRole('button', { name: 'Type' }).click();
    await askingPage.getByRole('option', { name: 'Laptop', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add action' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await submit(askingPage);

    // it stops at their own company first: they do not decide
    await expect(askingPage.getByText(/AWAITING CUSTOMER APPROVAL/i).first()).toBeVisible({
      timeout: 25_000,
    });
    await asking.close();

    const deciding = await browser.newContext(as('manager'));
    const decidingPage = await deciding.newPage();

    await approve(decidingPage);
    await deciding.close();

    const ours = await browser.newContext(as('technician'));
    const oursPage = await ours.newPage();

    await land(oursPage);
    await go(oursPage, 'Requests');
    await openRow(oursPage, MACHINE_ASKER);

    const accept = oursPage.getByRole('button', { name: /^Accept all( pending| \d+)$/ }).first();

    await expect(accept).toBeVisible({ timeout: 25_000 });
    await accept.click();
    await expect(oursPage.getByText('Line review complete')).toBeVisible({ timeout: 25_000 });
    await oursPage.getByRole('button', { name: 'Continue to Execute' }).click();
    await oursPage.waitForLoadState('networkidle');

    // the machine the customer described is work to prepare, not a service to invent
    await expect(
      oursPage.getByRole('button', { name: /Prepare \d+ Devices/ }),
      'the machine asked for lands on the preparation list'
    ).toBeVisible({ timeout: 25_000 });

    await ours.close();
  });
});

test.describe('A service that runs on a machine needs a machine', () => {
  test.use(as('requester'));

  test('it is offered shut, with the reason, to somebody who holds none', async ({ page }) => {
    await startRequest(page, MACHINE_ASKER);

    const card = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();

    await expect(card, 'the service is still listed').toBeVisible({ timeout: 20_000 });

    const add = card.getByRole('button', { name: /^Add/ });

    await expect(add, 'and its Add is shut, not missing').toBeDisabled();
    await expect(add).toHaveAttribute('title', /Give them a Device first/);
  });
});

test.describe('A machine is taken back', () => {
  test.use(as('admin'));

  // two machines, because the two stories that follow must not fight over one: a machine with
  // a holder change already pending is rightly refused a second one
  test('two machines are handed to somebody, so each story has its own', async ({ page }) => {
    for (const [hostname, serial] of [
      ['ZZE2E-KEEP-01', 'ZZE2E-SN-KEEP1'],
      ['ZZE2E-KEEP-02', 'ZZE2E-SN-KEEP2'],
    ] as const) {
      await land(page);
      await go(page, 'Devices');
      await page.getByRole('button', { name: 'New device' }).click();

      const dialog = page.getByRole('dialog');

      await dialog.getByRole('button', { name: 'Select a customer' }).click();
      await page.getByRole('option', { name: /ZZE2E Journey/ }).first().click();
      await dialog.getByRole('button', { name: /Nobody/ }).click();
      await page.getByRole('option', { name: new RegExp(MACHINE_KEEPER) }).first().click();
      await dialog.getByLabel('Hostname').fill(hostname);
      await dialog.getByLabel('Serial number').fill(serial);
      await dialog.getByRole('button', { name: /^Add device$/ }).click();
      await expect(dialog).toHaveCount(0, { timeout: 25_000 });

      await go(page, 'Devices');
      await seek(page, hostname);
    }
  });
});

test.describe('One person having no machine does not hold the others back', () => {
  test.use(as('requester'));

  test('the act applies to whoever can take it, and names who cannot', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    // one holds a machine, one holds none
    for (const person of [MACHINE_KEEPER, MACHINE_ASKER]) await addExisting(page, person);

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });

    const card = page.locator('tbody tr').filter({ hasText: MACHINE_SERVICE }).first();
    const add = card.getByRole('button', { name: /^Add · \d+$/ });

    await expect(add, 'the act is offered, because somebody can take it').toBeEnabled({
      timeout: 20_000,
    });
    await add.click();

    const impact = page.getByRole('dialog');

    // the one with a machine is a target; the one without is named, with the reason
    // they hold two machines, so the act has a target on each: a service runs on a machine
    await expect(impact.getByLabel(`Include ${MACHINE_KEEPER}`).first()).toBeChecked();
    await expect(
      impact.getByText(new RegExp(MACHINE_ASKER)),
      'the person with no machine is named, not silently dropped'
    ).toBeVisible();
    await expect(impact.getByLabel(`Include ${MACHINE_ASKER}`).first()).toBeDisabled();

    await impact.getByRole('button', { name: /^Cancel$/ }).click();
  });
});

test.describe("Asking for a machine somebody else holds", () => {
  test('it becomes a change of holder, and the machine ends up with them', async ({ browser }) => {
    const asking = await browser.newContext(as('requester'));
    const askingPage = await asking.newPage();

    await startRequest(askingPage, MACHINE_ASKER);

    const row = askingPage.locator('tbody tr').filter({ hasText: 'Give a Device' }).first();

    await row.getByRole('button', { name: 'Ask for a Device' }).click();

    const dialog = askingPage.getByRole('dialog');
    const theirs = dialog.locator('tbody tr').filter({ hasText: MACHINE_ASKER }).first();

    // the choice already reads "One already on file"; the picker below it is the machine
    await expect(
      theirs.getByRole('button', { name: 'One already on file' }),
      'picking one on file is the default answer'
    ).toBeVisible();

    await theirs.getByRole('button', { name: 'Pick a Device' }).click();

    // the machine Omar holds: a legitimate answer to "which one"
    await askingPage.getByRole('option', { name: /ZZE2E-KEEP-02/ }).first().click();
    await dialog.getByRole('button', { name: 'Add action' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await submit(askingPage);
    await asking.close();

    const deciding = await browser.newContext(as('manager'));
    const decidingPage = await deciding.newPage();

    await approve(decidingPage);
    await deciding.close();

    const ours = await browser.newContext(as('technician'));
    const page = await ours.newPage();

    await land(page);
    await go(page, 'Requests');

    // the newest one: this person already has an earlier request, and opening by their name
    // would pick that one up instead
    await openRow(page, /SR-/);

    // what the customer asked as "give them this one" reaches us as a change of holder on the
    // machine they named, not as a refusal
    await expect(
      page.getByText('ZZE2E-KEEP-02').first(),
      'the machine they named is the one the work is about'
    ).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(new RegExp(MACHINE_ASKER)).first()).toBeVisible();

    const accept = page.getByRole('button', { name: /^Accept all( pending| \d+)$/ }).first();

    await expect(accept).toBeVisible({ timeout: 25_000 });
    await accept.click();
    await page.getByRole('button', { name: 'Continue to Execute' }).click();
    await page.waitForLoadState('networkidle');

    await runReadyWork(page, 'Change holder', 'zze2e.moved');

    await go(page, 'Devices');
    await seek(page, 'ZZE2E-KEEP-02');

    await expect(
      page.locator('tbody tr').filter({ hasText: 'ZZE2E-KEEP-02' }).first(),
      'the machine is now theirs'
    ).toContainText(new RegExp(MACHINE_ASKER));

    await ours.close();
  });
});

test.describe('And the customer can ask for it back', () => {
  test('return to stock is asked, agreed to, and carried out', async ({ browser }) => {
    const asking = await browser.newContext(as('requester'));
    const askingPage = await asking.newPage();

    await startRequest(askingPage, MACHINE_KEEPER);

    const row = askingPage
      .locator('tbody tr')
      .filter({ hasText: 'Take current Devices back into stock' })
      .first();

    await expect(row, 'taking a machine back is askable too').toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: 'Review Devices' }).click();

    const dialog = askingPage.getByRole('dialog');

    await expect(dialog.getByText('ZZE2E-KEEP-01').first()).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Add action' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    await submit(askingPage);
    await asking.close();

    const deciding = await browser.newContext(as('manager'));
    const decidingPage = await deciding.newPage();

    await approve(decidingPage);
    await deciding.close();

    const ours = await browser.newContext(as('technician'));
    const oursPage = await ours.newPage();

    await land(oursPage);
    await go(oursPage, 'Requests');

    // the newest: these two people carry several requests by now, and a name picks the oldest
    await openRow(oursPage, /SR-/);
    await expect(oursPage.getByText('ZZE2E-KEEP-01').first()).toBeVisible({ timeout: 25_000 });

    const accept = oursPage.getByRole('button', { name: /^Accept all( pending| \d+)$/ }).first();

    await expect(accept).toBeVisible({ timeout: 25_000 });
    await accept.click();
    await oursPage.getByRole('button', { name: 'Continue to Execute' }).click();
    await oursPage.waitForLoadState('networkidle');

    await runReadyWork(oursPage, 'Return to stock', 'zze2e.keep');

    // the machine is on file, in stock, held by nobody
    await go(oursPage, 'Devices');
    await seek(oursPage, 'ZZE2E-KEEP-01');

    await expect(
      oursPage.locator('tbody tr').filter({ hasText: 'ZZE2E-KEEP-01' }).first()
    ).toContainText(/STOCK|Unassigned/i);

    await ours.close();
  });
});
