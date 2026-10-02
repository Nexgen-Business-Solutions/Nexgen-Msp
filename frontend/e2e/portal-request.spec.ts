import { expect, test, type Page } from '@playwright/test';
import { asManager, asRequester, asTechnician, goToSection, openHome, openRequest, paddingY, startWork } from './helpers';

const NEWCOMER = 'ZZE2E Newcomer';
const NOTE = 'Newcomer starts on Monday and needs a laptop.';

const startRequest = async (page: Page) => {
  await openHome(page);
  await goToSection(page, 'Requests');
  await page.getByRole('button', { name: 'New request' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
};

const scopeRail = (page: Page) => page.locator('aside').filter({ hasText: 'Apply actions to' });

const pickScope = async (page: Page, entry: RegExp) => {
  await scopeRail(page).getByRole('button', { name: entry }).click();
};

const topRequest = async (page: Page) =>
  (await page.locator('tbody tr').first().locator('td').first().innerText()).trim();

test.describe('A customer raises a request, from the first click to the record', () => {
  test.use(asManager);

  test('the whole journey: pick a person, add a change, review, submit', async ({ page }) => {
    await openHome(page);
    await goToSection(page, 'Requests');

    const before = await topRequest(page);

    await page.getByRole('button', { name: 'New request' }).click();
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    expect(await paddingY(page.getByRole('button', { name: /Entire company/ }))).toEqual([
      '10px',
      '10px',
    ]);
    await expect(page.getByText('Every selection method feeds the same table.')).toBeVisible();

    await page.getByRole('button', { name: /Existing user/ }).click();
    await page.getByLabel('Search').fill('ZZE2E Alice');
    await page.getByRole('button', { name: 'Add ZZE2E Alice' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    const row = page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' });

    await expect(row).toContainText('ZZE2E-PC-ALICE');
    await expect(row).toContainText('+ 1 more');
    await expect(row.getByTitle(/ZZE2E Mailbox/).first()).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByText('Group actions stay explicit')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ZZE2E Alice', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'ZZE2E Alice details' })).toContainText('ZZE2E-PC-ALICE');
    await pickScope(page, /^All selected/);
    await expect(page.getByRole('heading', { name: 'All selected people' })).toBeVisible();

    await page
      .locator('tbody tr')
      .filter({ hasText: 'ZZE2E Mailbox' })
      .getByRole('button', { name: /^End · 1$/ })
      .click();
    await expect(page.getByText('Will apply')).toBeVisible();
    await page.getByRole('button', { name: 'Add action' }).click();

    await expect(page.getByText(/1 target · All selected/)).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByRole('heading', { name: 'Review request' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText('Confirm the exact snapshot and requested actions before submission.')
    ).toBeVisible();

    const summary = page.getByRole('region', { name: 'Request summary' });

    await expect(summary).toContainText('1People in snapshot');
    await expect(summary).toContainText('1Concrete targets');

    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByRole('button', { name: 'New request' })).toBeVisible({ timeout: 30_000 });

    await expect.poll(() => topRequest(page), { timeout: 20_000 }).not.toBe(before);

    const raised = await topRequest(page);

    await expect(page.locator('tbody tr').first()).toContainText('SUBMITTED');

    await openRequest(page, raised);
    await expect(
      page.getByRole('region', { name: 'People' }).locator('tbody tr').filter({ hasText: 'ZZE2E Alice' })
    ).toHaveCount(1);
    await expect(
      page.getByRole('region', { name: 'Requested actions' }).getByText('End ZZE2E Mailbox', { exact: true })
    ).toBeVisible();
  });

  test('a whole Department is loaded into the same table', async ({ page }) => {
    await startRequest(page);

    await page.getByRole('button', { name: /Department/ }).click();
    await page.getByRole('button', { name: 'Select department' }).click();
    await page.getByRole('option', { name: /ZZE2E Finance/ }).click();

    const preview = page.getByText(/\d+ active people will be added\./);

    await expect(preview).toBeVisible();

    const promised = Number((await preview.textContent())?.match(/\d+/)?.[0]);

    await page.getByRole('button', { name: 'Load Department' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(promised);
    await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' })).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Bob' })).toHaveCount(1);
  });

  test('the entire company is counted before it is added', async ({ page }) => {
    await startRequest(page);

    await page.getByRole('button', { name: /Entire company/ }).click();

    const preview = page.getByText(/\d+ active people will be added\./);

    await expect(preview).toBeVisible();

    const promised = Number((await preview.textContent())?.match(/\d+/)?.[0]);

    expect(promised).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Add entire company' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(promised);
  });

  test('the rail narrows the scope and the workspace follows', async ({ page }) => {
    await startRequest(page);

    await page.getByRole('button', { name: /Entire company/ }).click();
    await page.getByRole('button', { name: 'Add entire company' }).click();
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByRole('heading', { name: 'All selected people' })).toBeVisible();

    await page.getByRole('button', { name: /ZZE2E Finance/ }).first().click();
    await expect(page.getByRole('heading', { name: 'ZZE2E Finance Department' })).toBeVisible();

    await page.getByRole('button', { name: /ZZE2E Carol/ }).first().click();
    await expect(page.getByRole('heading', { name: 'ZZE2E Carol' })).toBeVisible();
  });
});

test.describe('A request for somebody who is not on file yet, put aside and sent later', () => {
  test.describe.configure({ mode: 'serial' });

  let raised = '';

  test.describe('the requester', () => {
    test.use(asRequester);

    test('names a future person by full name only and asks a new machine for them', async ({
      page,
    }) => {
      await startRequest(page);

      await page.getByRole('button', { name: 'New user', exact: true }).click();

      const person = page.getByRole('dialog');

      await expect(person.getByRole('heading', { name: 'New person' })).toBeVisible();
      await person.getByLabel('Full name').fill(NEWCOMER);
      await person.getByRole('button', { name: 'Add person' }).click();
      await expect(person).toHaveCount(0);

      const row = page.locator('tbody tr').filter({ hasText: NEWCOMER });

      await expect(row).toContainText('NEW');
      await expect(row).toContainText('No Department');

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByText('Group actions stay explicit')).toBeVisible();
      await expect(page.getByRole('heading', { name: NEWCOMER, exact: true })).toBeVisible();
      await pickScope(page, /^All selected/);
      await expect(page.getByRole('heading', { name: 'All selected people' })).toBeVisible();

      await page
        .locator('tbody tr')
        .filter({ hasText: 'ZZE2E Mailbox' })
        .getByRole('button', { name: /^Add · 1$/ })
        .click();

      const impact = page.getByRole('dialog');

      await expect(impact.getByRole('checkbox', { name: `Include ${NEWCOMER}` })).toBeChecked();
      await impact.getByRole('button', { name: 'Add action' }).click();
      await expect(impact).toHaveCount(0);

      await page.getByRole('button', { name: 'Ask for a Device' }).click();

      const asking = page.getByRole('dialog');

      await asking.getByRole('button', { name: 'One that already exists' }).click();
      await page.getByRole('option', { name: 'A new one' }).click();
      await asking.getByRole('button', { name: `New device for ${NEWCOMER}` }).click();

      const described = page.getByRole('dialog').filter({ hasText: 'Fill what you have.' });

      await expect(described.getByRole('heading', { name: 'New device' })).toBeVisible();
      await described.getByRole('button', { name: 'Not known yet' }).click();
      await page.getByRole('option', { name: 'Laptop', exact: true }).click();
      await described.getByRole('button', { name: 'Add device' }).click();
      await expect(described).toHaveCount(0);

      await expect(asking.getByText('New laptop')).toBeVisible();
      await asking.getByRole('button', { name: 'Add action' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await expect(page.getByText(/Add ZZE2E Mailbox/).first()).toBeVisible();
      await expect(page.getByText(/1 target · All selected\s*NEW DEVICE/)).toBeVisible();

      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByLabel('Request note').fill(NOTE);
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible({ timeout: 20_000 });

      await goToSection(page, 'Requests');

      const drafts = page.locator('tbody tr').filter({ hasText: 'DRAFT' });

      await expect(drafts).toHaveCount(1);
      raised = await drafts.locator('td').first().innerText();
      expect(raised).toMatch(/^SR-/);
    });

    test('reopens the draft exactly as it was left and sends it', async ({ page }) => {
      await openHome(page);
      await goToSection(page, 'Requests');
      await page.locator('tbody tr').filter({ hasText: raised }).locator('td').first().click();

      await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'People · 1' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Actions · 2' })).toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: NEWCOMER });

      await expect(row).toContainText('NEW');

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByText(/Add ZZE2E Mailbox/).first()).toBeVisible();
      await expect(page.getByText(/1 target · All selected\s*NEW DEVICE/)).toBeVisible();

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByLabel('Request note')).toHaveValue(NOTE);

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByRole('heading', { name: 'Review request' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText('2 NEW ENTITIES', { exact: true })).toBeVisible();

      const entities = page.getByRole('region', { name: 'Requested entities' });

      await expect(entities.getByText(NEWCOMER, { exact: true })).toBeVisible();
      await expect(entities.getByText('New laptop', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Submit request' }).click();
      await expect(page.getByRole('button', { name: 'New request' })).toBeVisible({ timeout: 30_000 });

      const sent = page.locator('tbody tr').filter({ hasText: raised });

      await expect(sent).toHaveCount(1);
      await expect(sent).not.toContainText('DRAFT');
      await expect(page.locator('tbody tr').filter({ hasText: 'DRAFT' })).toHaveCount(0);
    });
  });

  test.describe('the manager who approves', () => {
    test.use(asManager);

    test('reads the same request under an approval bar and sends it to Nexgen', async ({ page }) => {
      await openRequest(page, raised);

      const bar = page.getByText('Internal approval required');

      await expect(bar).toBeVisible();
      await expect(
        page.getByText('Approval records intent only. No MSP lifecycle operation is executed here.')
      ).toBeVisible();
      await expect(page.getByText(/Review the exact request submitted by ZZE2E asker/)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Request information' })).toContainText(
        'Awaiting approval'
      );

      await page.getByRole('button', { name: 'Reject', exact: true }).click();

      const reject = page.getByRole('dialog');

      await expect(reject.getByRole('heading', { name: 'Reject request' })).toBeVisible();
      await expect(
        reject.getByText('A reason is required and will be visible in the request history.')
      ).toBeVisible();
      await expect(reject.getByRole('button', { name: 'Reject request' })).toBeDisabled();
      await reject.getByRole('button', { name: 'Cancel' }).click();
      await expect(reject).toHaveCount(0);

      await page.getByRole('button', { name: 'Approve and send to Nexgen' }).click();

      await expect(bar).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole('region', { name: 'Request information' })).toContainText(
        /Approved · ZZE2E manager/
      );

      await goToSection(page, 'Requests');
      await expect(page.locator('tbody tr').filter({ hasText: raised })).toContainText('SUBMITTED');
    });
  });
});

test.describe('A sent request, modified by the person who raised it until the work starts', () => {
  test.describe.configure({ mode: 'serial' });

  let raised = '';

  test.describe('the person who raised it', () => {
    test.use(asManager);

    test('sends it, then swaps one action for another without changing its status', async ({
      page,
    }) => {
      await openHome(page);
      await goToSection(page, 'Requests');

      const before = await topRequest(page);

      await page.getByRole('button', { name: 'New request' }).click();
      await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
      await page.getByRole('button', { name: /Existing user/ }).click();
      await page.getByLabel('Search').fill('ZZE2E Bob');
      await page.getByRole('button', { name: 'Add ZZE2E Bob' }).click();
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Bob' })).toHaveCount(1);

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByText('Group actions stay explicit')).toBeVisible();
      await pickScope(page, /^All selected/);
      await page
        .locator('tbody tr')
        .filter({ hasText: 'ZZE2E Mailbox' })
        .getByRole('button', { name: /^End · 1$/ })
        .click();
      await page.getByRole('button', { name: 'Add action' }).click();
      await expect(page.getByRole('button', { name: 'Remove End ZZE2E Mailbox' })).toBeVisible();

      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByRole('button', { name: 'Submit request' }).click();
      await expect(page.getByRole('button', { name: 'New request' })).toBeVisible({ timeout: 30_000 });

      raised = await topRequest(page);
      expect(raised).not.toBe(before);
      expect(raised).toMatch(/^SR-/);
      await expect(page.locator('tbody tr').filter({ hasText: raised })).toContainText('SUBMITTED');

      await openRequest(page, raised);

      const information = page.getByRole('region', { name: 'Request information' });

      await expect(information).not.toContainText('Last modified');
      await page.getByRole('button', { name: 'Edit request' }).click();

      await expect(page.getByRole('heading', { name: `Edit request ${raised}` })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole('button', { name: /Save draft/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0);
      await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Bob' })).toHaveCount(1);

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByText('Group actions stay explicit')).toBeVisible();
      await page.getByRole('button', { name: 'Remove End ZZE2E Mailbox' }).click();
      await expect(page.getByText('No action added yet.')).toBeVisible();

      await pickScope(page, /^All selected/);
      await page
        .locator('tbody tr')
        .filter({ hasText: 'ZZE2E VPN access' })
        .getByRole('button', { name: /^Add · 1$/ })
        .click();
      await page.getByRole('button', { name: 'Add action' }).click();
      await expect(page.getByRole('button', { name: 'Remove Add ZZE2E VPN access' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove End ZZE2E Mailbox' })).toHaveCount(0);

      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByRole('button', { name: 'Submit request' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByRole('heading', { name: `Request ${raised}` })).toBeVisible({
        timeout: 30_000,
      });

      const actions = page.getByRole('region', { name: 'Requested actions' });

      await expect(actions.getByText('Add ZZE2E VPN access', { exact: true })).toBeVisible();
      await expect(actions.getByText('End ZZE2E Mailbox', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Request information' })).toContainText(
        'Last modified'
      );
      await expect(page.getByRole('button', { name: 'Edit request' })).toBeVisible();

      await goToSection(page, 'Requests');
      await expect(page.locator('tbody tr').filter({ hasText: raised })).toContainText('SUBMITTED');
    });
  });

  test.describe('Nexgen', () => {
    test.use(asTechnician);

    test('starts the work on it', async ({ page }) => {
      await openRequest(page, raised);
      await expect(
        page.getByRole('region', { name: 'Requested actions' }).getByText('Add ZZE2E VPN access', { exact: true })
      ).toBeVisible();
      await startWork(page);
      await expect(page.getByRole('heading', { name: 'Review lines' })).toBeVisible({ timeout: 25_000 });
    });
  });

  test.describe('the person who raised it, once the work has started', () => {
    test.use(asManager);

    test('is no longer offered to modify it', async ({ page }) => {
      await openRequest(page, raised);
      await expect(
        page.getByRole('region', { name: 'Requested actions' }).getByText('Add ZZE2E VPN access', { exact: true })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit request' })).toHaveCount(0);
    });
  });
});
