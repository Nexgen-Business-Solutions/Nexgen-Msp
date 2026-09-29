import { expect, type Locator, type Page } from '@playwright/test';
import { go, startWork } from '../journey/ground';
import { actLabel, day, departmentName, escape, futureName, futureOf, hostnameOf, personName, requestedLabel, serialOf, targetName } from './refs';
import { facts, openRequest, requestRow } from './compose';
import type { Decision, ExecStep, Preparation, RowRef, Scenario } from './scenarios';
import { signIn, type Window } from './window';

const workspace = (page: Page) => page.getByRole('region', { name: 'Execution workspace' });
const executionRail = (page: Page) => page.getByRole('complementary', { name: 'Execution view' });
const reviewed = (page: Page) => page.getByRole('region', { name: 'Requested actions' });

export const companyDecides = async (window: Window, s: Scenario, name: string) => {
  const page = window.page;
  const decision = s.approval as NonNullable<Scenario['approval']>;

  await signIn(window, 'manager');
  await go(page, 'Requests');

  const banner = page.getByText(/waiting for your accord/);

  await expect(banner, 'the approver is told what waits for them').toBeVisible({ timeout: 25_000 });
  await openRequest(page, name);
  await expect(page.getByText('Internal approval required')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('region', { name: 'Request information' })).toContainText('Awaiting approval');

  if (decision === 'approve') {
    await page.getByRole('button', { name: 'Approve and send to Nexgen' }).click();
    await expect(page.getByText('Internal approval required')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Request information' })).toContainText(/Approved · /);
    expect(facts(s).request?.status).toBe('Submitted');

    return;
  }

  await page.getByRole('button', { name: 'Reject', exact: true }).click();

  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Reject request' }) });
  const confirm = dialog.getByRole('button', { name: 'Reject request' });

  await expect(confirm, 'a refusal with no reason is not a refusal').toBeDisabled();
  await dialog.getByLabel('Reason *').fill(decision.refuse);
  await confirm.click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Internal approval required')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(decision.refuse).first()).toBeVisible();

  const refused = facts(s);

  expect(refused.request?.status).toBe('Rejected');
  expect(refused.request?.rejection_reason).toBe(decision.refuse);
};

export const neverAtNexgen = async (window: Window, name: string) => {
  const page = window.page;

  await signIn(window, 'technician');
  await go(page, 'Requests');
  await page.getByRole('textbox', { name: /Search/i }).first().fill(name);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('tbody tr').filter({ hasText: name }), 'what the company refused never reaches Nexgen').toHaveCount(0);
};

export const beginWork = async (window: Window, s: Scenario, name: string) => {
  const page = window.page;

  await signIn(window, 'technician');

  const row = await requestRow(page, name);

  await expect(row).toContainText(/SUBMITTED/i);
  await openRequest(page, name);
  await expect(reviewed(page).getByRole('button', { name: /^Accept/ }), 'nothing is decided before the work starts').toHaveCount(0);
  await expect(reviewed(page).getByRole('button', { name: /^Reject/ })).toHaveCount(0);
  await startWork(page);
  expect(facts(s).request?.status).toBe('Under Review');
};

export const lockedForCustomer = async (window: Window, s: Scenario, name: string) => {
  const page = window.page;

  await signIn(window, s.asker);
  await openRequest(page, name);
  await expect(page.getByRole('heading', { name: `Request ${name}` }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Edit request' }), 'the work has started: it is no longer theirs to change').toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Request information' })).toContainText('Last modified');
  await signIn(window, 'technician');
  await openRequest(page, name);
};

const lineOf = (page: Page, text: string) => reviewed(page).locator('tr[data-line-idx]').filter({ hasText: text });
const groupOf = (page: Page, label: string) =>
  reviewed(page).locator('[data-group]').filter({ has: page.getByText(label, { exact: true }) });

const clickAll = async (page: Page, buttons: Locator) => {
  await page.waitForLoadState('networkidle');

  while (await buttons.count()) {
    const before = await buttons.count();

    try {
      await buttons.first().click({ timeout: 5_000 });
    } catch (error) {
      await page.waitForLoadState('networkidle');

      if (await buttons.count()) throw error;

      break;
    }

    await expect.poll(() => buttons.count(), { timeout: 25_000 }).toBeLessThan(before);
    await page.waitForLoadState('networkidle');
  }
};

const decideOne = async (page: Page, s: Scenario, decision: Decision) => {
  if ('accept' in decision) {
    if (decision.accept === 'groups') await clickAll(page, reviewed(page).locator('button:enabled', { hasText: 'Accept all' }));

    await clickAll(
      page,
      reviewed(page)
        .locator('tr[data-line-idx], [data-group]:not(:has(tr[data-line-idx]))')
        .filter({ hasNotText: 'REJECTED' })
        .getByRole('button', { name: 'Accept', exact: true })
    );

    return;
  }

  if ('refuseLine' in decision) {
    const text = targetName(s, decision.refuseLine);
    const line = decision.act
      ? groupOf(page, actLabel(decision.act)).locator('tr[data-line-idx]').filter({ hasText: text })
      : lineOf(page, text);
    const groups = decision.act ? groupOf(page, actLabel(decision.act)) : reviewed(page).locator('[data-group]');
    const scope = (await line.count()) ? line : groups.filter({ hasText: text });

    await scope.getByRole('button', { name: 'Reject', exact: true }).first().click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Reject request line' }) });

    await expect(dialog.getByText('A reason is required and stays on the record.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reject line' })).toBeDisabled();
    await dialog.getByRole('textbox').first().fill(decision.reason);
    await dialog.getByRole('button', { name: 'Reject line' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });
    await expect(scope.getByText('REJECTED', { exact: true }).first()).toBeVisible({ timeout: 25_000 });

    return;
  }

  if ('refuseGroup' in decision) {
    const group = groupOf(page, actLabel(decision.refuseGroup));

    await group.getByRole('button', { name: 'Reject all' }).click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Reject request' }) });

    await dialog.getByRole('textbox').first().fill(decision.reason);
    await dialog.getByRole('button', { name: 'Reject request' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });

    return;
  }

  await page.getByRole('button', { name: 'Reject request', exact: true }).click();

  const prompt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Reject request' }) });

  await prompt.getByLabel('Reason').fill(decision.refuseRequest);
  await prompt.getByRole('button', { name: 'Confirm' }).click();
  await expect(prompt).toHaveCount(0, { timeout: 25_000 });
};

export const decide = async (window: Window, s: Scenario) => {
  const page = window.page;
  const outcome = s.outcome;

  await expect(page.getByText(/^\d+ decisions? remaining$/), 'the review offers a decision per line').toBeVisible({
    timeout: 25_000,
  });
  await expect(reviewed(page).getByRole('button', { name: /^(Accept|Reject)/ }).first()).toBeVisible();

  for (const decision of s.decisions ?? []) await decideOne(page, s, decision);

  if (s.decisions?.some((decision) => 'refuseRequest' in decision)) {
    expect(facts(s).request?.status).toBe('Rejected');

    return false;
  }

  await expect(page.getByText(`${outcome?.accepted ?? 0} accepted · ${outcome?.rejected ?? 0} rejected`)).toBeVisible({
    timeout: 25_000,
  });

  const decided = facts(s);

  expect(decided.lines.filter((line) => line.status === 'Approved')).toHaveLength(outcome?.accepted ?? 0);
  expect(decided.lines.filter((line) => line.status === 'Rejected')).toHaveLength(outcome?.rejected ?? 0);

  await page.getByRole('button', { name: 'Continue to Execute' }).click();
  await expect(page.getByRole('heading', { name: 'Execute', exact: true })).toBeVisible({ timeout: 25_000 });
  await page.waitForLoadState('networkidle');
  expect(facts(s).request?.status).toBe('Approved');

  return true;
};

export const view = async (page: Page, entry: 'all' | string) => {
  const name = entry === 'all' ? /^All remaining work/ : new RegExp(`^${escape(entry)}`);
  const button = executionRail(page).getByRole('button', { name }).first();

  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'true');
  await page.waitForLoadState('networkidle');
};

const entityRow = (page: Page, text: string) =>
  workspace(page).locator('tr[data-requested-entity]').filter({ hasText: text });

const cancelOne = async (page: Page, s: Scenario, step: Preparation, how: { cancel: string; takes: number }) => {
  const person = 'person' in step;
  const row = entityRow(page, person ? futureName(s, futureOf(s, step.person)) : requestedLabel(s, step.machine));
  const title = person ? 'Cancel requested user' : 'Cancel requested Device';

  await row.getByTitle('More options').click();

  const menu = page.getByRole('menu', { name: 'More options' });

  await expect(menu.getByRole('menuitem'), 'one entry on an open requested row').toHaveText(['Cancel']);
  await menu.getByRole('menuitem', { name: 'Cancel' }).click();

  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });
  const confirm = dialog.getByRole('button', { name: title, exact: true });

  await expect(dialog.getByRole('region', { name: 'Cancelled with it' }).getByRole('listitem'), 'the work that goes with it is named').toHaveCount(how.takes);
  await expect(confirm, 'a reason is required').toBeDisabled();
  await dialog.getByLabel('Reason').fill(how.cancel);
  await confirm.click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await expect(row).toContainText('Cancelled');
  await expect(row).toContainText(how.cancel);
  await expect(row.getByTitle('More options'), 'a cancelled row offers nothing more').toHaveCount(0);
};

const prepareOne = async (page: Page, s: Scenario, step: Preparation) => {
  if (typeof step.how === 'object' && 'cancel' in step.how) return cancelOne(page, s, step, step.how);

  if ('person' in step) {
    const name = futureName(s, futureOf(s, step.person));
    const row = entityRow(page, name);

    if (step.ownView) {
      await view(page, name);
      await expect(workspace(page).getByRole('heading', { name }), 'the future person has a view of their own').toBeVisible();
      await expect(row.getByRole('button', { name: 'Create user' }), 'and it opens on creating them').toBeEnabled();
    }

    await row.getByRole('button', { name: 'Create user' }).click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Prepare requested Client User' }) });

    if (step.opensOn) await expect(dialog.getByRole('tab', { name: step.opensOn })).toHaveAttribute('aria-selected', 'true');

    await expect(dialog.getByRole('region', { name: 'Requested information' })).toContainText(name);

    if (step.how === 'create') {
      await expect(dialog.getByRole('textbox', { name: 'Full name' }), 'the name came with the request').toHaveValue(name);

      const spec = futureOf(s, step.person);

      if (spec.username) await expect(dialog.getByRole('textbox', { name: 'Username' })).toHaveValue(spec.username);
      if (spec.email) await expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveValue(spec.email);

      if (step.department) {
        await dialog.getByRole('button', { name: /Select a department|ZZE2E Matrix/ }).first().click();
        await page.getByRole('listbox').getByRole('option', { name: new RegExp(escape(departmentName(step.department))) }).first().click();
      }
    } else {
      const existing = personName(s, step.how.useExisting);

      await dialog.getByRole('tab', { name: 'Use existing' }).click();
      await dialog.getByPlaceholder('Name, email, username…').fill(existing);
      await dialog.getByRole('radio', { name: existing }).check();
    }

    await dialog.getByRole('button', { name: 'Save & resolve' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(row).toContainText('Completed');
    await expect(row).toContainText(step.how === 'create' ? 'Created during fulfilment' : 'Existing Client User selected');

    if (step.noCancelOnceDone) await expect(row.getByTitle('More options'), 'cancel is not offered once resolved').toHaveCount(0);

    return;
  }

  const label = requestedLabel(s, step.machine);
  const row = entityRow(page, label);

  await row.getByRole('button', { name: 'Prepare Device' }).click();

  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Prepare requested Device' }) });

  if (step.opensOn) {
    await expect(dialog.getByRole('tab', { name: step.opensOn })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
  }

  if (step.how === 'register') {
    await dialog.getByRole('tab', { name: 'Register new Device' }).click();

    const hostname = dialog.getByRole('textbox', { name: 'Hostname', exact: true });
    const serial = dialog.getByRole('textbox', { name: 'Serial number', exact: true });

    if (!(await hostname.inputValue())) await hostname.fill(hostnameOf(s, step.machine));
    if (!(await serial.inputValue())) await serial.fill(serialOf(s, step.machine));
  } else {
    const machine = 'stock' in step.how ? { stock: step.how.stock } : { heldBy: step.how.heldBy };
    const hostname = targetName(s, machine);

    await dialog.getByRole('tab', { name: 'Use existing Device' }).click();
    await dialog.getByPlaceholder('Hostname, serial, holder…').fill(hostname);
    await dialog.getByRole('radio', { name: hostname }).check();
  }

  await dialog.getByRole('button', { name: 'Save & resolve' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(row).toContainText('Completed');
  await expect(row).toContainText(step.how === 'register' ? 'Registered during fulfilment' : 'Existing Device selected');

  if (step.noCancelOnceDone) await expect(row.getByTitle('More options'), 'cancel is not offered once resolved').toHaveCount(0);
};

export const prepare = async (window: Window, s: Scenario) => {
  const page = window.page;

  if (!s.prepare?.length) return;

  await view(page, 'all');

  for (const step of s.prepare) {
    if ('machine' in step && step.waitsFor) {
      const owner = futureName(s, futureOf(s, step.waitsFor));
      const row = entityRow(page, requestedLabel(s, step.machine));

      await expect(row, 'a machine waits for the person it goes to').toContainText(`Waits for ${owner}`);
      await expect(row.getByRole('button', { name: 'Prepare Device' })).toBeDisabled();
    }
  }

  for (const step of s.prepare) await prepareOne(page, s, step);
};

const workRow = (page: Page, s: Scenario, row: RowRef) =>
  workspace(page)
    .locator('tr[data-work-order]')
    .filter({ hasText: targetName(s, row.target) })
    .filter({ hasText: actLabel(row.act) });

export const usernames = async (window: Window, s: Scenario) => {
  const page = window.page;
  const plan = s.usernames;

  if (!plan) return;

  await view(page, 'all');

  if ('dialog' in plan) {
    const owed = page.getByRole('button', { name: /^Complete \d+ usernames$/ });

    await expect(owed, 'the work says which usernames it still needs').toBeVisible({ timeout: 25_000 });
    await owed.click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Complete required usernames' }) });
    const fields = dialog.getByRole('textbox', { name: /^Username for / });

    await expect(fields.first()).toBeVisible();

    if (plan.taken) {
      await fields.first().fill('zze2e.mx.p061');
      await dialog.getByRole('button', { name: 'Save & continue' }).click();
      await expect(dialog.getByText(/is already used by another Client User/)).toBeVisible({ timeout: 20_000 });
      await expect(fields.first()).toHaveAttribute('aria-invalid', 'true');
    }

    for (const [index, box] of (await fields.all()).entries()) {
      await box.fill(`zze2e.mx.${s.id.toLowerCase()}.${index + 1}`);
    }

    await dialog.getByRole('button', { name: 'Save & continue' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });
    await expect(owed).toHaveCount(0, { timeout: 25_000 });

    return;
  }

  for (const [index, ref] of plan.rows.entries()) {
    const row = workspace(page).locator('tr[data-work-order]').filter({ hasText: personName(s, ref) }).first();

    await row.getByRole('button', { name: 'Complete username' }).click();

    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Complete required usernames' }) });

    await dialog.getByRole('textbox', { name: /^Username for / }).first().fill(`zze2e.mx.${s.id.toLowerCase()}.r${index + 1}`);
    await dialog.getByRole('button', { name: 'Save & continue' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });
  }
};

const expectedDefault = (s: Scenario) => {
  const drafted = typeof s.send === 'object' ? (s.send.changes ?? []) : [];
  const dates = [
    s.requestedDate,
    ...drafted.flatMap((c) => ('date' in c ? [c.date] : [])),
    ...(s.modifications ?? []).flatMap((m) => m.changes.flatMap((c) => ('date' in c ? [c.date] : []))),
  ];
  const last = dates.filter((value) => value !== undefined).pop();

  return day(last ?? 0);
};

const dated = async (
  page: Page,
  s: Scenario,
  date?: number,
  handTo?: { to: string; reason: string },
  refused?: number
) => {
  const dialog = page.getByRole('dialog').filter({ has: page.getByText('Billing counts from this date.') });

  await expect(dialog, 'the work asks for its effective date first').toBeVisible({ timeout: 20_000 });

  const title = ((await dialog.getByRole('heading').first().textContent()) ?? '').trim();
  const field = dialog.getByLabel('Effective date');

  await expect(field, 'the date offered is the one the request asked for').toHaveValue(expectedDefault(s));

  if (refused !== undefined) {
    await expect(field, 'nothing before the day the request was created is offered').toHaveAttribute('min', day(0));
    await field.fill(day(refused));
    await expect(dialog.getByRole('button', { name: title, exact: true })).toBeDisabled();
    await field.fill(expectedDefault(s));
  }

  if (date !== undefined) await field.fill(day(date));

  if (handTo) {
    await dialog.getByRole('button', { name: /Hand over to/ }).click();
    await page.getByRole('listbox').getByRole('textbox').fill(handTo.to);
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(`^${escape(handTo.to)}`) }).first().click();
    await dialog.getByLabel('Reason').fill(handTo.reason);
  }

  await dialog.getByRole('button', { name: title, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 40_000 });
  await page.waitForLoadState('networkidle');
};

const finished = (page: Page) => page.getByRole('heading', { name: 'Execution recap' });

const readyButton = (page: Page) => page.getByRole('button', { name: /^Execute \d+ ready$/ });

const runRow = async (
  page: Page,
  s: Scenario,
  row: RowRef,
  date?: number,
  handTo?: { to: string; reason: string },
  refused?: number
) => {
  const line = workRow(page, s, row);

  await expect(line, `${actLabel(row.act)} for ${targetName(s, row.target)} is one row`).toHaveCount(1);
  await expect(line).toContainText('Ready');
  await line.getByRole('button').first().click();
  await dated(page, s, date, handTo, refused);
  await expect(line.or(finished(page)).first()).toBeVisible({ timeout: 30_000 });

  if (await line.count()) await expect(line).toContainText('Completed', { timeout: 30_000 });
};

const runReady = async (page: Page, s: Scenario, date?: number, refused?: number) => {
  await expect(readyButton(page)).toBeVisible({ timeout: 25_000 });
  await readyButton(page).click();
  await dated(page, s, date, undefined, refused);
};

const stepThrough = async (window: Window, s: Scenario, name: string, step: ExecStep) => {
  const page = window.page;

  if ('leaveAndReturn' in step) {
    await go(page, 'Requests');
    await openRequest(page, name);
    await expect(page.getByRole('heading', { name: 'Execute', exact: true })).toBeVisible({ timeout: 25_000 });

    return;
  }

  if ('ready' in step) {
    await view(page, 'all');
    await runReady(page, s, step.date, step.refused);

    return;
  }

  if ('group' in step) {
    await view(page, actLabel(step.group));
    await runReady(page, s, step.date, step.refused);

    return;
  }

  if ('row' in step) {
    await view(page, 'all');
    await runRow(
      page,
      s,
      step.row,
      step.date,
      step.handTo ? { to: personName(s, step.handTo.to), reason: step.handTo.reason } : undefined,
      step.refused
    );

    return;
  }

  await view(page, personName(s, step.person));
  await expect(workspace(page).getByRole('heading', { name: personName(s, step.person) })).toBeVisible();

  if (!step.rows) {
    await runReady(page, s, step.date);

    return;
  }

  for (const entry of step.rows) await runRow(page, s, entry.row, entry.date);
};

export const execute = async (window: Window, s: Scenario, name: string) => {
  for (const step of s.execute ?? []) await stepThrough(window, s, name, step);

  await expect(finished(window.page), 'every accepted line was carried out').toBeVisible({ timeout: 40_000 });
};

export const closeRequest = async (window: Window, s: Scenario, name: string) => {
  const page = window.page;
  const outcome = s.outcome;

  if (s.recap) {
    await page.getByRole('button', { name: s.recap }).click();
    await expect(page.getByRole('button', { name: s.recap })).toHaveAttribute('aria-pressed', 'true');
  }

  for (const step of s.prepare ?? []) {
    if (typeof step.how === 'object' && 'cancel' in step.how) {
      await expect(
        page.getByRole('region', { name: 'Requested entities' }),
        'the recap says what was cancelled and why'
      ).toContainText(step.how.cancel);
    }
  }

  await page.getByRole('button', { name: 'Continue to Final validation' }).click();

  const summary = page.getByRole('region', { name: 'Completion summary' });

  await expect(summary.getByText('READY TO COMPLETE', { exact: true })).toBeVisible({ timeout: 25_000 });

  const accepted = outcome?.accepted ?? 0;
  const rejected = outcome?.rejected ?? 0;
  const cancelled = outcome?.cancelled ?? 0;
  const done = accepted - cancelled;

  await expect(summary).toContainText(`${done} accepted request line${done === 1 ? '' : 's'} completed`);

  if (cancelled) {
    await expect(summary, 'what was cancelled is counted').toContainText(
      `${cancelled} accepted work item${cancelled === 1 ? '' : 's'} cancelled`
    );
  }

  if (rejected) await expect(summary, 'what was refused is said').toContainText(`${rejected} rejected request line${rejected === 1 ? '' : 's'}`);

  await expect(summary).toContainText('0 unresolved accepted work items');
  await page.getByRole('button', { name: 'Validate & complete request' }).click();
  await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible({ timeout: 25_000 });
  expect(facts(s).request?.status).toBe('Completed');

  const row = await requestRow(page, name);

  await expect(row).toContainText(/COMPLETED/i);
};
