import { expect, type Page } from '@playwright/test';
import { go, seek } from '../journey/ground';
import { matrix, type Assignment } from './ground';
import { facts, openRequest } from './compose';
import { day, departmentName, futureName, futureOf, machineName, personName, requestedLabel } from './refs';
import type { HeldService, Scenario } from './scenarios';
import { signIn, type Window } from './window';

const cancellations = (s: Scenario) =>
  (s.prepare ?? []).flatMap((step) =>
    typeof step.how === 'object' && 'cancel' in step.how
      ? [{ person: 'person' in step ? step.person : null, machine: 'machine' in step ? step.machine : null, reason: step.how.cancel }]
      : []
  );

const compare = (held: Assignment[] | undefined, wanted: HeldService[]) => {
  const want = wanted.map((row) => ({
    service: matrix.services[row.service],
    status: row.status as string,
    start: row.start === undefined ? undefined : day(row.start),
    end: row.end === undefined ? undefined : day(row.end),
  }));
  const got = (held ?? []).map((row) => {
    const match = want.find((entry) => entry.service === row.service && entry.status === row.status);

    return {
      service: row.service,
      status: row.status,
      start: match?.start === undefined ? undefined : row.start,
      end: match?.end === undefined ? undefined : row.end,
    };
  });
  const order = (a: { service: string; status: string }, b: { service: string; status: string }) =>
    `${a.service}|${a.status}`.localeCompare(`${b.service}|${b.status}`);

  return { got: got.sort(order), want: want.sort(order) };
};

export const recordsHold = (s: Scenario) => {
  const outcome = s.outcome;

  if (!outcome) return;

  const people = (outcome.people ?? []).map((entry) => personName(s, entry.who));
  const machines = (outcome.machines ?? []).map((entry) => machineName(s, entry.machine));
  const read = facts(s, people, machines);

  expect(read.request?.status, `${s.id} ends ${outcome.status}`).toBe(outcome.status);
  expect(read.lines, 'lines == targets asked').toHaveLength(outcome.lines);

  if (outcome.accepted !== undefined) {
    expect(read.lines.filter((line) => line.status === 'Approved')).toHaveLength(outcome.accepted);
    expect(read.work_orders.filter((order) => order.origin !== 'Technician')).toHaveLength(
      outcome.status === 'Completed' ? outcome.accepted : read.work_orders.length
    );
  }

  for (const step of s.execute ?? []) {
    if ('row' in step && step.handTo) {
      expect(
        read.work_orders.filter((order) => order.override_reason === step.handTo?.reason),
        'the reason for handing it to somebody else is kept'
      ).toHaveLength(1);
    }
  }

  if (outcome.status === 'Completed') {
    expect(
      read.work_orders.filter((order) => order.status !== 'Completed' && order.status !== 'Cancelled'),
      'every work order was carried out'
    ).toHaveLength(0);
    expect(
      read.work_orders.filter((order) => order.status === 'Cancelled'),
      'exactly the work that went with a cancellation is cancelled'
    ).toHaveLength(outcome.cancelled ?? 0);
  }

  for (const cancelled of cancellations(s)) {
    const entry = cancelled.person
      ? read.requested_people.find((row) => row.name === futureName(s, futureOf(s, cancelled.person as string)))
      : read.requested_machines.find((row) => row.label === requestedLabel(s, cancelled.machine as string));

    expect([entry?.status, entry?.cancel_reason], 'the requested entity is cancelled with its reason').toEqual([
      'Cancelled',
      cancelled.reason,
    ]);

    if (cancelled.person) {
      const name = futureName(s, futureOf(s, cancelled.person));

      expect(facts(s, [name]).people[name]?.exists, `${name} was never created`).toBe(0);
    }
  }

  for (const entry of outcome.people ?? []) {
    const name = personName(s, entry.who);
    const held = read.people[name];

    expect(held?.exists, `${name} is on file once`).toBe(1);

    const services = compare(held.services, entry.services);

    expect(services.got, `${name} holds exactly this`).toEqual(services.want);

    if (entry.machines) {
      expect(held.machines, `${name} holds exactly these machines`).toEqual(
        entry.machines.map((ref) => machineName(s, ref)).sort()
      );
    }

    if (entry.username) expect(held.username).toBe(entry.username);
    if (entry.department) expect(held.department).toBe(departmentName(entry.department));
  }

  for (const entry of outcome.machines ?? []) {
    const hostname = machineName(s, entry.machine);
    const held = read.machines[hostname];

    expect(held?.exists, `${hostname} is on file once`).toBe(1);
    expect(held.holder ?? null, `${hostname} is held by the right person`).toBe(entry.holder ? personName(s, entry.holder) : null);

    if (entry.services) {
      const services = compare(held.services, entry.services);

      expect(services.got, `${hostname} runs exactly this`).toEqual(services.want);
    }
  }
};

const openPerson = async (page: Page, name: string) => {
  await go(page, 'Users');
  await seek(page, name);
  await page.locator('tbody tr').filter({ hasText: name }).first().locator('td').first().click();
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 25_000 });
  await page.waitForLoadState('networkidle');
};

const openMachine = async (page: Page, hostname: string) => {
  await go(page, 'Devices');
  await seek(page, hostname);
  await page.locator('tbody tr').filter({ hasText: hostname }).first().locator('td').first().click();
  await expect(page.getByRole('heading', { name: hostname }).first()).toBeVisible({ timeout: 25_000 });
  await page.waitForLoadState('networkidle');
};

const serviceRows = (page: Page, label: string) => page.locator('tbody tr').filter({ hasText: label });

const servicesShown = async (page: Page, services: HeldService[], owner: string, empty = `No service assignment is recorded for ${owner}.`) => {
  if (!services.length) {
    await expect(page.getByText(empty)).toBeVisible();

    return;
  }

  for (const row of services) {
    const label = matrix.services[row.service];
    const shown = serviceRows(page, label).filter({ hasText: new RegExp(row.status, 'i') });

    await expect(shown, `${owner}: ${label} ${row.status}`).toHaveCount(
      services.filter((other) => other.service === row.service && other.status === row.status).length
    );

    if (row.start !== undefined) await expect(shown.first()).toContainText(day(row.start));
    if (row.end !== undefined) await expect(shown.first()).toContainText(day(row.end));
  }
};

export const screensShow = async (window: Window, s: Scenario) => {
  const page = window.page;
  const outcome = s.outcome;

  if (!outcome || (!outcome.people?.length && !outcome.machines?.length)) return;

  await signIn(window, 'technician');

  for (const entry of outcome.people ?? []) {
    const name = personName(s, entry.who);

    await openPerson(page, name);

    if (entry.formerly?.length) {
      const rows = page.locator('tbody tr').filter({ hasText: /held \d{4}-\d{2}-\d{2}/ });

      await expect(page.getByText(`No service assignment is recorded for ${name}.`)).toHaveCount(0);
      await expect(page.locator('tbody tr').filter({ hasText: 'Person' }), `${name} holds no service of their own`).toHaveCount(0);

      await expect(rows, `${name} only shows what ran on the machines they handed over`).toHaveCount(entry.formerly.length);

      for (const former of entry.formerly) {
        await expect(rows.filter({ hasText: machineName(s, former.machine) })).toContainText(`to ${day(former.until)}`);
      }
    } else {
      const held = (entry.machines ?? []).map((ref) => machineName(s, ref));
      const onMachines = (outcome.machines ?? [])
        .filter((machine) => held.includes(machineName(s, machine.machine)))
        .flatMap((machine) => machine.services ?? []);

      await servicesShown(page, [...entry.services, ...onMachines], name);
    }

    for (const machine of entry.machines ?? []) {
      await expect(page.locator('tbody tr').filter({ hasText: machineName(s, machine) }).first()).toBeVisible();
    }
  }

  for (const entry of outcome.machines ?? []) {
    const hostname = machineName(s, entry.machine);

    await openMachine(page, hostname);

    if (entry.holder) await expect(page.locator('main')).toContainText(personName(s, entry.holder));

    for (const former of entry.formerly ?? []) {
      const spells = page
        .getByRole('heading', { name: 'Who has held it', exact: true })
        .locator('xpath=../..')
        .locator('tbody tr')
        .filter({ hasText: personName(s, former.holder) });

      await expect(spells, `${hostname} was held by ${personName(s, former.holder)} until ${day(former.until)}`).toHaveCount(1);
      await expect(spells).toContainText(day(former.until));
    }
    if (entry.services) {
      await servicesShown(page, entry.services, hostname, 'No service assignment is recorded for this Device.');
    }
  }
};

export const customerReads = async (window: Window, s: Scenario, name: string) => {
  const page = window.page;
  const outcome = s.outcome;

  if (!s.customerReads || !outcome) return;

  await signIn(window, s.asker);
  await openRequest(page, name);
  await expect(page.getByRole('heading', { name: `Request ${name}` }).first()).toBeVisible({ timeout: 25_000 });

  const header = page.locator('section').filter({ has: page.getByRole('heading', { name: `Request ${name}` }) }).first();

  await expect(header, 'the customer reads where it ended').toContainText(new RegExp(outcome.status.replace(/ /g, '\\s+'), 'i'));
  await expect(page.getByRole('button', { name: 'Edit request' })).toHaveCount(0);

  const listed = page.getByRole('region', { name: 'Requested actions' });
  const read = facts(s);

  for (const toggle of await listed.getByRole('button', { name: 'View details' }).all()) {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }

  for (const line of read.lines) {
    if (line.status === 'Rejected' && line.reason) {
      await expect(listed.getByText(line.reason).first(), 'the customer reads why a line was refused').toBeVisible();
    }
  }

  if (s.approval && typeof s.approval === 'object') {
    await expect(page.getByText(s.approval.refuse).first(), 'and why the company refused it').toBeVisible();
  }

  const refusedWhole = read.request?.status === 'Rejected';

  await expect(listed.getByText('REJECTED', { exact: true })).toHaveCount(
    refusedWhole ? read.lines.length : read.lines.filter((line) => line.status === 'Rejected').length
  );
  const cancelledLines = new Set(read.work_orders.filter((order) => order.status === 'Cancelled').map((order) => order.line));

  await expect(listed.getByText('ACCEPTED', { exact: true })).toHaveCount(
    refusedWhole ? 0 : read.lines.filter((line) => line.status === 'Approved' && !cancelledLines.has(line.idx)).length
  );

  if (cancelledLines.size) {
    await expect(listed.getByText('CANCELLED', { exact: true }), 'the customer reads which lines were cancelled').toHaveCount(cancelledLines.size);
  }

  for (const cancelled of cancellations(s)) {
    await expect(page.getByText(cancelled.reason, { exact: true }), 'and why, said once').toHaveCount(1);
  }
};
