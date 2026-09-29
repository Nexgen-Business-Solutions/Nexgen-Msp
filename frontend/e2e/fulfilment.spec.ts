import { expect, test, type Page } from '@playwright/test';
import {
  asManager,
  asTechnician,
  confirmEffectiveDate,
  fixture,
  goToSection,
  openHome,
  openRequest,
  startWork,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const RECRUIT = 'ZZE2E Recruit';
const HELD = 'ZZE2E-PC-CAROL';

const workspace = (page: Page) => page.getByRole('region', { name: 'Execution workspace' });
const rail = (page: Page) => page.getByRole('complementary', { name: 'Execution view' });
const workRow = (page: Page, action: string) =>
  workspace(page).locator('tbody tr[data-work-order]').filter({ hasText: action });
const entityRow = (page: Page, name: string) =>
  workspace(page).locator('tbody tr[data-requested-entity]').filter({ hasText: name });

const pick = async (page: Page, entry: RegExp) => {
  await rail(page).getByRole('button', { name: entry }).click();
  await page.waitForLoadState('networkidle');
};

test.describe('The customer reads the acts they asked for', () => {
  test.use(asManager);

  test('the request is presented as action groups, with the counts it was raised with', async ({
    page,
  }) => {
    await openRequest(page, fixture.request);

    const actions = page.getByRole('region', { name: 'Requested actions' });

    await expect(actions.getByText('End ZZE2E Helpdesk', { exact: true })).toBeVisible();
    await expect(actions.getByText('2 targets from 4 people')).toBeVisible();
    await expect(actions.getByText('2 left unchanged')).toBeVisible();

    const summary = page.getByRole('region', { name: 'Request summary' });

    await expect(summary).toContainText('4People in snapshot');
    await expect(summary).toContainText('2Concrete targets');
    await expect(summary).toContainText('0New entities');
  });

  test('the people an act did not reach are named, with the reason', async ({ page }) => {
    await openRequest(page, fixture.request);

    const actions = page.getByRole('region', { name: 'Requested actions' });

    await actions.getByRole('button', { name: 'View details' }).click();

    const targets = actions.locator('tbody tr');

    await expect(targets).toHaveCount(2);
    await expect(targets.filter({ hasText: 'ZZE2E Alice' })).toHaveCount(1);
    await expect(targets.filter({ hasText: 'ZZE2E Bob' })).toHaveCount(1);

    await actions.getByRole('button', { name: 'View unchanged' }).click();

    const unchanged = actions.getByRole('listitem');

    await expect(unchanged).toHaveCount(2);
    await expect(unchanged.filter({ hasText: 'ZZE2E Carol' })).toContainText(/\S+\s+\S+/);
    await expect(unchanged.filter({ hasText: 'ZZE2E Dan' })).toHaveCount(1);
    await expect(unchanged.filter({ hasText: 'ZZE2E Alice' })).toHaveCount(0);
  });
});

test.describe('Nexgen carries the work out', () => {
  test.use(asTechnician);

  test('the review offers one decision for the whole act, and the lines keep it', async ({
    page,
  }) => {
    await openRequest(page, fixture.request);
    await startWork(page);

    await expect(page.getByText('2 decisions remaining')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to Execute' })).toBeDisabled();

    const actions = page.getByRole('region', { name: 'Requested actions' });

    await actions.getByRole('button', { name: 'Accept all' }).click();

    await expect(page.getByText('2 accepted · 0 rejected')).toBeVisible({ timeout: 20_000 });
    await expect(actions.getByText('ACCEPTED', { exact: true })).toHaveCount(2);

    await openRequest(page, fixture.request);
    await expect(page.getByText('2 accepted · 0 rejected')).toBeVisible();
  });

  test('the act runs as one button and each target is carried out on its own', async ({ page }) => {
    await openRequest(page, fixture.request);

    await page.getByRole('button', { name: 'Continue to Execute' }).click();
    await expect(page.getByRole('heading', { name: 'Execute', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await pick(page, /^All remaining work/);

    const rows = workspace(page).locator('tbody tr');

    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Ready' })).toHaveCount(2);

    await page.getByRole('button', { name: 'Execute 2 ready' }).click();
    await confirmEffectiveDate(page, 'Execute 2 ready');

    await expect(page.getByRole('heading', { name: 'Execution recap' })).toBeVisible({
      timeout: 30_000,
    });

    const recap = page.getByRole('region', { name: 'End ZZE2E Helpdesk' });

    await expect(recap.getByText('2 completed')).toBeVisible();
    await expect(recap.getByText('ZZE2E Alice', { exact: true })).toBeVisible();
    await expect(recap.getByText('ZZE2E Bob', { exact: true })).toBeVisible();

    await openHome(page);
    await goToSection(page, 'Users');
    await page.getByRole('textbox', { name: /Search/ }).first().fill('ZZE2E Alice');
    await page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' }).locator('td').first().click();
    await expect(page.getByRole('heading', { name: 'ZZE2E Alice' }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('tr').filter({ hasText: 'ZZE2E Helpdesk' }).filter({ hasText: /Active/ })
    ).toHaveCount(0);
  });
});

test.describe('The information a customer was never asked for', () => {
  test.use(asTechnician);

  test('what is owed is named, entered in one dialog, and kept when the page is left', async ({
    page,
  }) => {
    await openRequest(page, fixture.add_request);
    await pick(page, /^All remaining work/);

    const owed = page.getByRole('button', { name: 'Complete 2 usernames' });

    await expect(owed).toBeVisible({ timeout: 20_000 });
    await expect(workRow(page, 'ZZE2E Carol').getByRole('button', { name: 'Add service' })).toBeDisabled();
    await expect(
      workRow(page, 'ZZE2E Carol').getByRole('button', { name: 'Complete username' })
    ).toBeEnabled();

    await owed.click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('heading', { name: 'Complete required usernames' })).toBeVisible();
    await expect(dialog.getByText('MISSING', { exact: true })).toHaveCount(2);

    await dialog.getByRole('textbox', { name: 'Username for ZZE2E Carol' }).fill('e2e.first');
    await dialog.getByRole('button', { name: 'Save progress' }).click();

    await expect(dialog.getByText('SAVED', { exact: true })).toHaveCount(1, { timeout: 20_000 });
    await expect(dialog.getByText('MISSING', { exact: true })).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Complete 1 usernames' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(workRow(page, 'ZZE2E Carol').getByRole('button', { name: 'Add service' })).toBeEnabled();

    await openRequest(page, fixture.add_request);
    await pick(page, /^All remaining work/);

    await expect(page.getByRole('button', { name: 'Complete 1 usernames' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(workRow(page, 'ZZE2E Carol')).toContainText('Ready');
    await expect(workRow(page, 'ZZE2E Dan')).toContainText('Needs information');
  });

  test('a username already taken is refused on its own row, in plain words', async ({ page }) => {
    await openRequest(page, fixture.add_request);
    await pick(page, /^All remaining work/);
    await page.getByRole('button', { name: 'Complete 1 usernames' }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('textbox', { name: 'Username for ZZE2E Dan' }).fill('e2e.first');
    await dialog.getByRole('button', { name: 'Save & continue' }).click();

    await expect(dialog.getByText(/is already used by another Client User/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.getByText('ERROR', { exact: true })).toHaveCount(1);
    await expect(dialog.getByRole('textbox', { name: 'Username for ZZE2E Dan' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });
});

test.describe('A request for somebody who does not exist yet, carried out to the end', () => {
  test.use(asTechnician);

  test('the review decides each act as a whole and names what is still to come', async ({
    page,
  }) => {
    await openRequest(page, fixture.new_person_request);
    await startWork(page);

    await expect(page.getByText('3 decisions remaining')).toBeVisible();

    const entities = page.getByRole('region', { name: 'Requested entities' });

    await expect(entities.getByText(RECRUIT, { exact: true })).toBeVisible();
    await expect(entities.getByText('New laptop', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Attention' })).toHaveCount(0);
    await expect(page.getByText(`${RECRUIT} does not exist as a Client User yet.`)).toHaveCount(0);

    const actions = page.getByRole('region', { name: 'Requested actions' });
    const accepts = actions.getByRole('button', { name: 'Accept', exact: true });

    await expect(actions.getByRole('button', { name: 'Accept all' })).toHaveCount(0);
    await expect(actions.locator('table')).toHaveCount(0);
    await expect(accepts).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      await accepts.first().click();
      await expect(actions.getByText('ACCEPTED', { exact: true })).toHaveCount(index + 1, { timeout: 20_000 });
    }

    await expect(page.getByText('3 accepted · 0 rejected')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Execute' }).click();
    await expect(page.getByRole('heading', { name: 'Execute', exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await openHome(page);
    await goToSection(page, 'Requests');
    await page.getByRole('textbox', { name: /^Search a request/ }).fill(fixture.new_person_request);
    await expect(
      page.locator('tbody tr').filter({ hasText: fixture.new_person_request })
    ).toContainText(/APPROVED|IN PROGRESS/);
  });

  test('a blocked row keeps its requested action visible and disabled, under the row that unblocks it', async ({
    page,
  }) => {
    await openRequest(page, fixture.new_person_request);

    await pick(page, /^Add ZZE2E Mailbox/);

    const mailbox = workRow(page, 'Add ZZE2E Mailbox');

    await expect(mailbox).toContainText('Waiting for prerequisite');
    await expect(mailbox).toContainText(`Waits for ${RECRUIT}`);
    await expect(mailbox.getByRole('button', { name: 'Add service' })).toBeDisabled();
    await expect(mailbox.getByRole('button', { name: 'Prepare person' })).toHaveCount(0);
    await expect(mailbox.getByRole('button', { name: 'More options' })).toBeDisabled();
    await expect(entityRow(page, RECRUIT).getByRole('button', { name: 'Create user' })).toBeEnabled();

    await pick(page, /^Assign device/);

    const machine = workRow(page, 'Assign device');

    await expect(machine).toContainText('New laptop');
    await expect(machine).toContainText('UNRESOLVED');
    await expect(machine.getByRole('button', { name: 'Assign Device' })).toBeDisabled();
    await expect(machine.getByRole('button', { name: 'Prepare Device' })).toHaveCount(0);
    await expect(entityRow(page, 'New laptop')).toContainText('Prepare Device');
    await expect(workspace(page).getByRole('region', { name: 'Preparation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Execute \d+ ready$/ })).toHaveCount(0);
  });

  test('the requested person is prepared by creating them', async ({ page }) => {
    await openRequest(page, fixture.new_person_request);
    await pick(page, /^Add ZZE2E Mailbox/);
    await entityRow(page, RECRUIT).getByRole('button', { name: 'Create user' }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('heading', { name: 'Prepare requested Client User' })).toBeVisible();
    await expect(dialog.getByRole('region', { name: 'Requested information' })).toContainText(RECRUIT);
    await expect(dialog.getByRole('textbox', { name: 'Full name' })).toHaveValue(RECRUIT);

    const resolve = dialog.getByRole('button', { name: 'Save & resolve' });

    await expect(resolve).toBeDisabled();
    await dialog.getByRole('button', { name: 'Select a department' }).click();
    await page.getByRole('option', { name: /ZZE2E Finance/ }).click();
    await expect(resolve).toBeEnabled();
    await resolve.click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const mailbox = workRow(page, 'Add ZZE2E Mailbox');

    await expect(mailbox).toContainText('Username required');
    await expect(mailbox).toContainText('ZZE2E Finance');
    await expect(mailbox.getByRole('button', { name: 'Complete username' })).toBeEnabled();
    await expect(entityRow(page, RECRUIT)).toContainText('Completed');
    await expect(entityRow(page, RECRUIT)).toContainText('Created during fulfilment');
    await expect(entityRow(page, RECRUIT).getByRole('button', { name: 'Create user' })).toHaveCount(0);

    await openHome(page);
    await goToSection(page, 'Users');
    await page.getByRole('textbox', { name: /Search/ }).first().fill(RECRUIT);
    await expect(page.locator('tbody tr').filter({ hasText: RECRUIT })).toHaveCount(1, {
      timeout: 20_000,
    });
  });

  test('the requested Device is prepared by choosing a machine somebody already holds', async ({
    page,
  }) => {
    await openRequest(page, fixture.new_person_request);
    await pick(page, /^Assign device/);
    await entityRow(page, 'New laptop').getByRole('button', { name: 'Prepare Device' }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('heading', { name: 'Prepare requested Device' })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Use existing Device' }).click();
    await expect(dialog.getByRole('tab', { name: 'Use existing Device' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await dialog.getByRole('textbox', { name: 'Search Devices' }).fill('PC-CAROL');

    const held = dialog.getByRole('radio', { name: HELD });

    await expect(held).toBeEnabled({ timeout: 20_000 });
    await expect(dialog.getByText(/Current holder: ZZE2E Carol/)).toBeVisible();
    await expect(
      dialog.getByText('Current status and holder are shown for context. Devices are not limited to unassigned stock.')
    ).toBeVisible();

    await held.check();
    await dialog.getByRole('button', { name: 'Save & resolve' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const machine = workRow(page, 'Assign device');

    await expect(machine).toContainText(HELD);
    await expect(machine).toContainText('ZZE2E Carol → ZZE2E Recruit');
    await expect(machine).toContainText('Ready');
    await expect(machine.getByRole('button', { name: 'Assign Device' })).toBeEnabled();
  });

  test('usernames are completed in one dialog, then the ready work runs together', async ({
    page,
  }) => {
    await openRequest(page, fixture.new_person_request);
    await pick(page, /^All remaining work/);

    await expect(page.getByRole('button', { name: 'Execute 2 ready' })).toBeVisible();
    await page.getByRole('button', { name: 'Complete 1 usernames' }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('textbox', { name: `Username for ${RECRUIT}` }).fill('zze2e.recruit');
    await dialog.getByRole('button', { name: 'Save & continue' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const rows = workspace(page).locator('tbody tr');

    await expect(rows).toHaveCount(5);
    await expect(rows.filter({ hasText: 'Ready' })).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Completed' })).toHaveCount(2);
    await expect(entityRow(page, 'New laptop')).not.toContainText('UNRESOLVED');
    await page.getByRole('button', { name: 'Execute 3 ready' }).click();
    await confirmEffectiveDate(page, 'Execute 3 ready');

    await expect(page.getByRole('heading', { name: 'Execution recap' })).toBeVisible({
      timeout: 40_000,
    });
  });

  test('the recap reads the same work by action and by person', async ({ page }) => {
    await openRequest(page, fixture.new_person_request);

    await expect(page.getByRole('heading', { name: 'Execution recap' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'By action' })).toHaveAttribute('aria-pressed', 'true');

    for (const action of ['Assign device', 'Add ZZE2E Antivirus', 'Add ZZE2E Mailbox']) {
      const block = page.getByRole('region', { name: action });

      await expect(block.getByText('1 completed')).toBeVisible();
      await expect(block.getByText('REQUESTED', { exact: true })).toBeVisible();
    }

    const entities = page.getByRole('region', { name: 'Requested entities' });

    await expect(entities.getByText('RESOLVED', { exact: true })).toHaveCount(2);
    await expect(entities).toContainText(`Requested Device · Laptop · ${HELD}`);

    await page.getByRole('button', { name: 'By person' }).click();

    const person = page.getByRole('region', { name: RECRUIT });

    await expect(person.getByText('REQUESTED', { exact: true })).toHaveCount(3);
    await expect(person.getByText('Client User created')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Assign device' })).toHaveCount(0);
  });

  test('final validation completes the request', async ({ page }) => {
    await openRequest(page, fixture.new_person_request);
    await page.getByRole('button', { name: 'Continue to Final validation' }).click();

    const summary = page.getByRole('region', { name: 'Completion summary' });

    await expect(summary.getByText('READY TO COMPLETE', { exact: true })).toBeVisible();
    await expect(summary).toContainText('3 accepted request lines completed');
    await expect(summary).toContainText('1 Requested Client User resolved');
    await expect(summary).toContainText('1 Requested Device resolved');
    await expect(summary).toContainText('0 unresolved accepted work items');

    await page.getByRole('button', { name: 'Validate & complete request' }).click();
    await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('textbox', { name: /^Search a request/ }).fill(fixture.new_person_request);
    await expect(
      page.locator('tbody tr').filter({ hasText: fixture.new_person_request })
    ).toContainText('COMPLETED');
  });

  test('the completed request shows what was asked and what was done', async ({ page }) => {
    await openRequest(page, fixture.new_person_request);

    await expect(
      page.getByText('Completed request · final intent and fulfilment outcome.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Validate & complete request' })).toHaveCount(0);

    const actions = page.getByRole('region', { name: 'Requested actions' });

    await expect(actions.getByText('Add ZZE2E Mailbox', { exact: true })).toBeVisible();
    await expect(actions.getByText('Assign device', { exact: true })).toBeVisible();

    const outcome = page.getByRole('region', { name: 'Fulfilment outcome' });

    await expect(outcome).toContainText(RECRUIT);
    await expect(outcome).toContainText('Created during fulfilment');
    await expect(outcome).toContainText('New laptop');
    await expect(outcome).toContainText(HELD);
    await expect(outcome).toContainText('Existing Device selected');
    await expect(outcome).toContainText('3 completed');

    await outcome.getByRole('link', { name: 'View Device' }).click();
    await expect(page.getByRole('heading', { name: HELD }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('main')).toContainText(RECRUIT);
  });
});
