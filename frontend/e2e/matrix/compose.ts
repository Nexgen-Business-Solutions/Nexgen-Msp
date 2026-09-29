import { expect, type Locator, type Page } from '@playwright/test';
import { go, seek } from '../journey/ground';
import { readMatrixFacts, type Facts } from './ground';
import {
  actLabel,
  day,
  departmentName,
  escape,
  futureName,
  hostnameOf,
  isAssign,
  isService,
  isTransfer,
  machineName,
  noteOf,
  personName,
  requestedLabel,
  serialOf,
  targetName,
} from './refs';
import type {
  Act,
  AssignAct,
  MachineRef,
  NewMachineSpec,
  PeopleStep,
  Refusal,
  ReturnAct,
  Scenario,
  Scope,
  ServiceAct,
  TransferAct,
} from './scenarios';
import { applyChanges } from './modify';
import { signIn, type Window } from './window';

const dialogNamed = (page: Page, title: string) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

const option = async (page: Page, name: string | RegExp) => {
  await page.getByRole('listbox').getByRole('option', { name }).first().click();
};

export const continueTo = async (page: Page, heading: string) => {
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  const arrived =
    heading === 'Actions'
      ? page.getByText('Apply actions to', { exact: true })
      : page.getByRole('heading', { name: heading, exact: true });

  await expect(arrived.first()).toBeVisible({
    timeout: 25_000,
  });
};

export const openBuilder = async (page: Page) => {
  await go(page, 'Requests');
  await page.getByRole('button', { name: 'New request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible({ timeout: 25_000 });
};

const peopleTable = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'People', exact: true }) }).locator('tbody tr');

export const addPeople = async (page: Page, s: Scenario, step: PeopleStep) => {
  if ('existing' in step) {
    await page.getByRole('button', { name: 'Select existing' }).click();

    const dialog = dialogNamed(page, 'Select existing user');

    for (const ref of step.existing) {
      const name = personName(s, ref);

      await dialog.getByLabel('Search').fill(name);
      await dialog.getByRole('button', { name: `Add ${name}`, exact: true }).click();
      await expect(peopleTable(page).filter({ hasText: name })).toHaveCount(1);
    }

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toHaveCount(0);

    return;
  }

  if ('future' in step) {
    const spec = step.future;
    const name = futureName(s, spec);

    await page.getByRole('button', { name: 'New user', exact: true }).click();

    const dialog = dialogNamed(page, 'New person');

    await dialog.getByLabel('Full name').fill(name);

    if (spec.department) {
      await dialog.getByRole('button', { name: /No Department yet/ }).click();
      await option(page, new RegExp(`^${escape(departmentName(spec.department))}`));
    }

    if (spec.email) await dialog.getByLabel('Email', { exact: true }).fill(spec.email);
    if (spec.username) await dialog.getByLabel('Username', { exact: true }).fill(spec.username);
    if (spec.startDate !== undefined) await dialog.getByLabel('Start date', { exact: true }).fill(day(spec.startDate));

    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(dialog).toHaveCount(0);

    const row = peopleTable(page).filter({ hasText: name });

    await expect(row).toHaveCount(1);
    await expect(row).toContainText('NEW');

    return;
  }

  if ('department' in step) {
    const department = departmentName(step.department);

    await page.getByRole('button', { name: 'Department', exact: true }).click();

    const dialog = dialogNamed(page, 'Add a Department');

    await dialog.getByRole('button', { name: /Select department/ }).click();
    await option(page, new RegExp(`^${escape(department)}`));

    const preview = dialog.getByText(/\d+ active people will be added\./);

    await expect(preview).toBeVisible({ timeout: 20_000 });

    const promised = Number(((await preview.textContent()) ?? '').match(/\d+/)?.[0]);

    await dialog.getByRole('button', { name: 'Load Department' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(peopleTable(page).filter({ hasText: department })).toHaveCount(promised);

    for (const ref of step.minus ?? []) {
      const name = personName(s, ref);

      await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
      await expect(peopleTable(page).filter({ hasText: name })).toHaveCount(0);
    }

    await expect(peopleTable(page).filter({ hasText: department })).toHaveCount(promised - (step.minus ?? []).length);

    return;
  }

  await page.getByRole('button', { name: 'Entire company' }).click();

  const dialog = dialogNamed(page, 'Add entire company');
  const preview = dialog.getByText(/\d+ active people will be added\./);

  await expect(preview).toBeVisible({ timeout: 30_000 });

  const promised = Number(((await preview.textContent()) ?? '').match(/\d+/)?.[0]);

  await dialog.getByRole('button', { name: 'Add entire company' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(peopleTable(page)).toHaveCount(promised, { timeout: 30_000 });
};

const rail = (page: Page) => page.locator('aside').filter({ hasText: 'Apply actions to' });

export const pickScope = async (page: Page, s: Scenario, scope: Scope) => {
  const title =
    scope === 'all'
      ? 'All selected'
      : 'person' in scope
        ? personName(s, scope.person)
        : departmentName(scope.department);
  const entry = rail(page).getByRole('button', { name: new RegExp(`^${escape(title)}`) }).first();

  await entry.click();
  await expect(entry).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Reading what can be asked…')).toHaveCount(0, { timeout: 30_000 });
};

const workspace = (page: Page) =>
  page.locator('main').filter({ hasText: 'Group actions stay explicit' }).last();

const chip = (page: Page, label: string) =>
  page.locator('[data-group]').filter({ has: page.locator('strong', { hasText: new RegExp(`^${escape(label)}$`) }) });

const describe = async (page: Page, s: Scenario, spec: NewMachineSpec) => {
  const modal = dialogNamed(page, 'New device');

  await expect(modal).toBeVisible();

  if (spec.type) {
    await modal.getByRole('button', { name: /Not known yet/ }).first().click();
    await option(page, spec.type);
  }

  if (spec.hostname) await modal.getByLabel('Hostname', { exact: true }).fill(hostnameOf(s, spec.key));
  if (spec.serial) await modal.getByLabel('Serial number', { exact: true }).fill(serialOf(s, spec.key));

  await modal.getByRole('button', { name: 'Add device' }).click();
  await expect(modal).toHaveCount(0);
};

const settleChecks = async (dialog: Locator, keep: string[] | null) => {
  if (!keep) return;

  const boxes = dialog.getByRole('checkbox');

  for (const box of await boxes.all()) {
    const label = ((await box.getAttribute('aria-label')) ?? '').replace(/^Include /, '');
    const wanted = keep.some((name) => label === name);

    if ((await box.isEnabled()) && (await box.isChecked()) !== wanted) await box.setChecked(wanted);
  }
};

const settleMachines = async (s: Scenario, dialog: Locator, machines?: MachineRef[]) => {
  if (!machines) return;

  const names = machines.map((ref) => targetName(s, ref));

  for (const row of await dialog.locator('tbody tr').all()) {
    const box = row.getByRole('checkbox');

    if (!(await box.isEnabled())) continue;

    const text = (await row.textContent()) ?? '';
    const on = names.some((name) => text.includes(name));

    if ((await box.isChecked()) !== on) await box.setChecked(on);
  }
};

const addServiceAct = async (page: Page, s: Scenario, act: ServiceAct) => {
  await pickScope(page, s, act.scope);

  const label = actLabel(act);
  const row = workspace(page).locator('tbody tr').filter({ hasText: new RegExp(escape(label.slice(act.op.length + 1))) });

  await row.getByRole('button', { name: new RegExp(`^${act.op}( · \\d+)?$`) }).click();

  const dialog = dialogNamed(page, label);

  await expect(dialog).toBeVisible();

  for (const slot of act.machines ?? []) {
    const person = personName(s, slot.for);

    if (slot.use) {
      const label = requestedLabel(s, slot.use);
      const use = dialog.getByRole('button', { name: `Use ${label} for ${person}`, exact: true });

      await expect(dialog.locator('tbody tr').filter({ hasText: person }).first()).toBeVisible();

      if (await use.count()) await use.click();

      await expect(dialog.locator('tbody tr').filter({ hasText: person }).filter({ hasText: label })).toContainText('Will apply');
    } else if (slot.describe) {
      await dialog.getByRole('button', { name: `New device for ${person}`, exact: true }).click();
      await describe(page, s, slot.describe);
    }
  }

  await settleChecks(dialog, act.only ? act.only.map((ref) => personName(s, ref)) : null);
  await settleMachines(s, dialog, act.onMachines);
  await dialog.getByRole('button', { name: 'Add action' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, label).first()).toBeVisible();
};

const deviceRow = (page: Page, operation: string) =>
  workspace(page).locator('tbody tr').filter({ hasText: new RegExp(`^${escape(operation)}`) });

const addAssignAct = async (page: Page, s: Scenario, act: AssignAct) => {
  await pickScope(page, s, act.scope ?? { person: act.assign });
  await deviceRow(page, 'Assign device').getByRole('button', { name: 'Ask for a Device' }).click();

  const dialog = dialogNamed(page, 'Ask for a Device');
  const person = personName(s, act.assign);

  await expect(dialog).toBeVisible();
  await settleChecks(dialog, [person]);

  const row = dialog.locator('tbody tr').filter({ hasText: person }).first();

  if (act.machine !== 'unspecified' && ('stock' in act.machine || 'heldBy' in act.machine)) {
    const hostname = machineName(s, act.machine);

    await row.getByRole('button', { name: `Choose a Device for ${person}`, exact: true }).click();

    const picker = page.getByRole('dialog').filter({ hasText: 'Every Device of this customer.' });

    await picker.getByRole('textbox', { name: 'Search devices' }).fill(hostname);
    await picker.getByRole('button', { name: `Choose ${hostname}`, exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(row).toContainText(hostname);
  } else if (act.machine !== 'unspecified') {
    await row.getByRole('button', { name: 'One that already exists' }).click();
    await option(page, 'A new one');

    if ('use' in act.machine) {
      await row.getByRole('button', { name: `Use ${requestedLabel(s, act.machine.use)} for ${person}`, exact: true }).click();
    } else {
      await row.getByRole('button', { name: `New device for ${person}`, exact: true }).click();
      await describe(page, s, act.machine.describe);
      await expect(row).toContainText('NEW DEVICE');
    }
  }

  await dialog.getByRole('button', { name: 'Add action' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, 'Assign device').first()).toBeVisible();
};

const addTransferAct = async (page: Page, s: Scenario, act: TransferAct) => {
  await pickScope(page, s, act.scope);
  await deviceRow(page, 'Change holder').getByRole('button', { name: 'Configure transfers' }).click();

  const dialog = dialogNamed(page, 'Configure holder changes');
  const hostname = machineName(s, act.transfer);
  const row = dialog.locator('tbody tr').filter({ hasText: hostname });

  await expect(row).toHaveCount(1);
  await row.getByRole('button').first().click();
  await option(page, new RegExp(`^${escape(personName(s, act.to))}`));
  await dialog.getByRole('button', { name: 'Add configured transfers' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, 'Change holder').first()).toBeVisible();
};

const addReturnAct = async (page: Page, s: Scenario, act: ReturnAct) => {
  await pickScope(page, s, act.scope);
  await deviceRow(page, 'Return to stock').getByRole('button', { name: 'Review Devices' }).click();

  const dialog = dialogNamed(page, 'Return to stock');

  await settleChecks(dialog, act.giveBack.map((ref) => machineName(s, ref)));
  await dialog.getByRole('button', { name: 'Add action' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, 'Return to stock').first()).toBeVisible();
};

export const addAct = async (page: Page, s: Scenario, act: Act) => {
  if (isService(act)) return addServiceAct(page, s, act);
  if (isAssign(act)) return addAssignAct(page, s, act);
  if (isTransfer(act)) return addTransferAct(page, s, act);

  return addReturnAct(page, s, act);
};

export const removeAct = async (page: Page, act: Act) => {
  const label = actLabel(act);
  const before = await chip(page, label).count();

  await page.getByRole('button', { name: `Remove ${label}`, exact: true }).first().click();
  await expect(chip(page, label)).toHaveCount(before - 1);
};

export const fillDetails = async (page: Page, s: Scenario, requestedDate?: number) => {
  if (s.refusedRequestedDate !== undefined) {
    const field = page.getByLabel('Requested date');

    await expect(field, 'a requested date before today is not offered').toHaveAttribute('min', day(0));
    await field.fill(day(s.refusedRequestedDate));
    expect(await field.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
    await field.fill(requestedDate === undefined ? '' : day(requestedDate));
  }

  if (requestedDate !== undefined) await page.getByLabel('Requested date').fill(day(requestedDate));

  await page.getByLabel('Request note').fill(noteOf(s));
};

const summaryOf = (page: Page, label: string) =>
  page
    .getByRole('region', { name: 'Request summary' })
    .locator('div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('p')
    .first();

export const reviewShows = async (page: Page, lines: number) => {
  await expect(page.getByRole('heading', { name: 'Review request' })).toBeVisible({ timeout: 25_000 });
  await expect(summaryOf(page, 'Concrete targets'), 'the review counts one target per line').toHaveText(String(lines), {
    timeout: 25_000,
  });
};

export const requestRow = async (page: Page, name: string) => {
  await go(page, 'Requests');
  await seek(page, name);

  return page.locator('tbody tr').filter({ hasText: name });
};

export const openRequest = async (page: Page, name: string) => {
  const row = await requestRow(page, name);

  await expect(row).toHaveCount(1);
  await row.locator('td').first().click();
  await page.waitForLoadState('networkidle');
};

export const detailShows = async (page: Page, s: Scenario, name: string, acts: Act[], lines: number) => {
  await expect(page.getByRole('heading', { name: `Request ${name}` }).first()).toBeVisible({ timeout: 25_000 });

  const listed = page.getByRole('region', { name: 'Requested actions' });
  const labels = acts.map(actLabel);

  for (const label of new Set(labels)) {
    await expect(
      listed.getByText(label, { exact: true }),
      `${label} is listed once per act`
    ).toHaveCount(labels.filter((entry) => entry === label).length);
  }

  await expect(summaryOf(page, 'Concrete targets'), `${s.id}: one target per line`).toHaveText(String(lines));
  await expect(summaryOf(page, 'Requested actions')).toHaveText(String(labels.length));
};

const composeInBuilder = async (page: Page, s: Scenario) => {
  for (const step of s.people) await addPeople(page, s, step);

  const chosen = await peopleTable(page).count();

  await continueTo(page, 'Actions');
  await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 25_000 });

  for (const act of s.acts) await addAct(page, s, act);

  await continueTo(page, 'Details');
  await fillDetails(page, s, s.requestedDate);

  return chosen;
};

export const facts = (s: Scenario, people: string[] = [], machines: string[] = []): Facts =>
  readMatrixFacts(noteOf(s), people, machines);

export const compose = async (window: Window, s: Scenario): Promise<string> => {
  const page = window.page;
  const lines = s.sentLines ?? s.outcome?.lines ?? 0;

  await signIn(window, s.asker);
  await openBuilder(page);

  const chosen = await composeInBuilder(page, s);

  if (typeof s.send === 'object') {
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible({ timeout: 25_000 });

    const kept = facts(s);

    expect(kept.request?.status, 'the draft is kept, not sent').toBe('Draft');

    const draft = kept.request?.name as string;
    const row = await requestRow(page, draft);

    await expect(row).toContainText(/DRAFT/i);
    await row.locator('td').first().click();
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: `People · ${chosen}` }), 'the people come back').toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole('button', { name: `Actions · ${s.acts.length}` }), 'and so do the acts').toBeVisible();
    await applyChanges(page, s, s.send.changes ?? []);
    await expect(page.getByLabel('Request note')).toHaveValue(noteOf(s));
  }

  await continueTo(page, 'Review request');
  await reviewShows(page, lines);
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('button', { name: 'New request', exact: true })).toBeVisible({ timeout: 30_000 });

  const sent = facts(s);

  expect(sent.count, 'one request carries this note').toBe(1);
  expect(sent.lines, 'one line per target asked').toHaveLength(lines);
  expect(sent.request?.status).toBe(s.asker === 'requester' ? 'Awaiting Customer Approval' : 'Submitted');

  const name = sent.request?.name as string;
  const row = await requestRow(page, name);

  await expect(row).toContainText(s.asker === 'requester' ? /AWAITING CUSTOMER APPROVAL/i : /SUBMITTED/i);
  await openRequest(page, name);
  await detailShows(page, s, name, currentActs(s, 'sent'), lines);

  return name;
};

export const currentActs = (s: Scenario, stage: 'sent' | 'final'): Act[] => {
  let acts = [...s.acts];
  const draft = typeof s.send === 'object' ? (s.send.changes ?? []) : [];
  const later = stage === 'final' ? (s.modifications ?? []).flatMap((modification) => modification.changes) : [];

  for (const change of [...draft, ...later]) {
    if ('addAct' in change) acts.push(change.addAct);
    if ('removeAct' in change) {
      const at = acts.findIndex((act) => actLabel(act) === actLabel(change.removeAct));

      if (at >= 0) acts = [...acts.slice(0, at), ...acts.slice(at + 1)];
    }
    if ('replaceFuture' in change) {
      const labels = change.acts.map(actLabel);

      acts = acts.filter((act) => !labels.includes(actLabel(act)));
      acts.push(...change.acts);
    }
  }

  return acts;
};

export const refuse = async (window: Window, s: Scenario, refusal: Refusal) => {
  const page = window.page;

  await signIn(window, s.asker);

  if (refusal.refusal === 'not-offered') {
    await go(page, 'Requests');
    await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: 'New request', exact: true }), `${s.asker} may not raise a request`).toHaveCount(0);
    await go(page, 'Portal Dashboard');
    await expect(page.getByRole('button', { name: /^New request$/i })).toHaveCount(0);

    for (const ref of refusal.people) {
      const name = personName(s, ref);

      await go(page, 'Users');
      await seek(page, name);
      await page.locator('tbody tr').filter({ hasText: name }).first().getByRole('button', { name: 'More options' }).click();
      await expect(page.getByRole('menuitem', { name: 'Open profile' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Raise a request for them' }), `nobody is raised a request for by ${s.asker}`).toHaveCount(0);
      await page.keyboard.press('Escape');
    }

    return;
  }

  await openBuilder(page);

  if (refusal.refusal === 'empty') {
    await expect(page.getByText('Add at least one person before continuing.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New request', exact: true })).toBeVisible({ timeout: 25_000 });

    return;
  }

  await addPeople(page, s, { existing: refusal.people });
  await continueTo(page, 'Actions');
  await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 25_000 });

  if (refusal.refusal === 'no-act') {
    await expect(page.getByText('Add at least one requested action before continuing.')).toBeVisible();
    await expect(page.getByText('No action added yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  }

  if (refusal.refusal === 'same-act-twice') {
    await addAct(page, s, refusal.act);

    const label = actLabel(refusal.act);
    const row = workspace(page).locator('tbody tr').filter({ hasText: label.slice(refusal.act.op.length + 1) });
    const again = row.getByRole('button', { name: new RegExp(`^${refusal.act.op}( · \\d+)?$`) });

    await expect(again, 'the same act cannot be added a second time').toBeDisabled();
    await expect(again).toHaveAttribute('title', 'Already asked for in this request');
    await expect(row.getByText('Asked', { exact: true })).toBeVisible();
    await expect(chip(page, label)).toHaveCount(1);
  }

  if (refusal.refusal === 'no-machine') {
    await pickScope(page, s, refusal.act.scope);

    const label = actLabel(refusal.act);
    const row = workspace(page).locator('tbody tr').filter({ hasText: label.slice(refusal.act.op.length + 1) });

    await row.getByRole('button', { name: new RegExp(`^${refusal.act.op}( · \\d+)?$`) }).click();

    const dialog = dialogNamed(page, label);

    for (const ref of refusal.people) {
      const person = personName(s, ref);

      await expect(dialog.getByLabel(`Include ${person}`), `${person} holds no machine`).toBeDisabled();
      await expect(dialog.locator('tbody tr').filter({ hasText: person })).toContainText('Left unchanged');
    }

    await expect(dialog.getByRole('button', { name: 'Add action' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('No action added yet.')).toBeVisible();
  }

  if (refusal.refusal === 'same-machine-twice') {
    await addAct(page, s, refusal.first);

    const machine = refusal.first.machine;
    const hostname = typeof machine === 'object' && ('stock' in machine || 'heldBy' in machine) ? machineName(s, machine) : '';
    const holder = personName(s, refusal.first.assign);

    for (const ref of refusal.again) {
      const person = personName(s, ref);

      await pickScope(page, s, { person: ref });
      await deviceRow(page, 'Assign device').getByRole('button', { name: 'Ask for a Device' }).click();

      const dialog = dialogNamed(page, 'Ask for a Device');

      await expect(dialog).toBeVisible();
      await settleChecks(dialog, [person]);
      await dialog
        .locator('tbody tr')
        .filter({ hasText: person })
        .first()
        .getByRole('button', { name: `Choose a Device for ${person}`, exact: true })
        .click();

      const picker = page.getByRole('dialog').filter({ hasText: 'Every Device of this customer.' });

      await picker.getByRole('textbox', { name: 'Search devices' }).fill(hostname);
      await expect(picker.getByRole('button', { name: `Choose ${hostname}`, exact: true }), 'one machine is asked once').toBeDisabled();
      await expect(picker.getByText(`Already asked for ${holder} in this request.`)).toBeVisible();
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(picker).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }

    await expect(chip(page, 'Assign device')).toHaveCount(1);
  }

  if (refusal.refusal === 'machine-two-ways') {
    await addAct(page, s, refusal.first);
    await addAct(page, s, refusal.second);
    await continueTo(page, 'Details');
    await continueTo(page, 'Review request');

    const refused = page.getByText(
      `${machineName(s, refusal.second.transfer)}: Two requested actions try to change the same target in incompatible ways. Review the highlighted actions.`,
      { exact: true }
    );
    const submit = page.getByRole('button', { name: 'Submit request' });

    await expect(refused.or(submit).first()).toBeVisible({ timeout: 25_000 });

    if (await submit.isVisible()) {
      await submit.click();
      await expect(refused, 'the one machine sent two ways is refused in so many words').toBeVisible({ timeout: 25_000 });
    }

    await expect(page.getByRole('heading', { name: 'Review request' }), 'nothing was sent').toBeVisible();
  }

  await go(page, 'Requests');
  await expect(page.getByRole('button', { name: 'New request', exact: true })).toBeVisible({ timeout: 25_000 });
};
