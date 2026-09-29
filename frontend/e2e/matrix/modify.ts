import { expect, type Page } from '@playwright/test';
import {
  addAct,
  addPeople,
  continueTo,
  currentActs,
  detailShows,
  facts,
  openRequest,
  removeAct,
  reviewShows,
} from './compose';
import { actLabel, day, escape, futureName, futureOf, personName } from './refs';
import type { Act, Change, Modification, Ref, Scenario } from './scenarios';
import { signIn, type Window } from './window';

const peopleRows = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'People', exact: true }) }).locator('tbody tr');

const removePersonNamed = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click();
  await expect(peopleRows(page).filter({ hasText: name })).toHaveCount(0);
};

const reviewImpact = async (page: Page, s: Scenario, act: Act, include: Ref[]) => {
  const label = actLabel(act);
  const group = page.locator('[data-group]').filter({ has: page.locator('strong', { hasText: new RegExp(`^${escape(label)}$`) }) });

  await expect(group.getByText('Needs review', { exact: true }), `${label} asks to be reviewed once people join`).toBeVisible();
  await group.getByRole('button', { name: 'Review impact' }).click();

  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: label, exact: true }) });

  await expect(dialog.getByText('Reading what can be asked…')).toHaveCount(0, { timeout: 30_000 });

  for (const ref of include) await dialog.getByLabel(`Include ${personName(s, ref)}`, { exact: true }).check();

  await dialog.getByRole('button', { name: 'Confirm impact' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(group.getByText('Needs review', { exact: true })).toHaveCount(0);
};

export const applyChanges = async (page: Page, s: Scenario, changes: Change[]) => {
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible({ timeout: 25_000 });

  for (const change of changes) {
    if ('addPeople' in change) await addPeople(page, s, change.addPeople);
    if ('removePerson' in change) await removePersonNamed(page, personName(s, change.removePerson));
    if ('replaceFuture' in change) {
      const before = s.people.flatMap((step) =>
        'future' in step && step.future.key === change.replaceFuture ? [step.future] : []
      )[0] ?? futureOf(s, change.replaceFuture);

      await removePersonNamed(page, futureName(s, before));
      await addPeople(page, s, { future: change.with });
    }
  }

  await continueTo(page, 'Actions');
  await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 25_000 });

  for (const change of changes) {
    if ('removeAct' in change) await removeAct(page, change.removeAct);
    if ('addAct' in change) await addAct(page, s, change.addAct);
    if ('replaceFuture' in change) for (const act of change.acts) await addAct(page, s, act);
    if ('reviewImpact' in change) await reviewImpact(page, s, change.reviewImpact, change.include ?? []);
  }

  await continueTo(page, 'Details');

  for (const change of changes) {
    if ('date' in change) await page.getByLabel('Requested date').fill(day(change.date));
  }
};

const statusWord = (status: string) => new RegExp(status.replace(/ /g, '\\s+'), 'i');

export const modify = async (window: Window, s: Scenario, name: string, modification: Modification, index: number) => {
  const page = window.page;
  const before = facts(s);
  const status = before.request?.status as string;

  await signIn(window, modification.by ?? s.asker);
  await openRequest(page, name);
  await expect(page.getByRole('heading', { name: `Request ${name}` }).first()).toBeVisible({ timeout: 25_000 });

  const information = page.getByRole('region', { name: 'Request information' });

  if (index === 0) await expect(information).not.toContainText('Last modified');

  await page.getByRole('button', { name: 'Edit request' }).click();
  await expect(page.getByRole('heading', { name: `Edit request ${name}` })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0);

  await applyChanges(page, s, modification.changes);

  const done = (s.modifications ?? []).slice(0, index + 1).flatMap((entry) => entry.changes);
  const acts = currentActs({ ...s, modifications: [{ changes: done }] }, 'final');
  const lines = linesAfter(s, index);

  await continueTo(page, 'Review request');
  await reviewShows(page, lines);
  await expect(page.getByRole('button', { name: 'Submit request' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes' }).click();

  await detailShows(page, s, name, acts, lines);
  await expect(information).toContainText('Last modified', { timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Edit request' })).toBeVisible();

  const after = facts(s);

  expect(after.request?.status, 'a modification keeps the status it had').toBe(status);
  expect(after.lines, 'one line per target now asked').toHaveLength(lines);
  expect(after.count).toBe(1);

  for (const change of modification.changes) {
    if ('date' in change) expect(after.request?.requested_date).toBe(day(change.date));
  }

  await page.getByRole('navigation').first().getByRole('button', { name: 'Requests', exact: true }).click();
  await page.getByRole('textbox', { name: /Search/i }).first().fill(name);
  await expect(page.locator('tbody tr').filter({ hasText: name })).toContainText(statusWord(status));
};

export const linesAfter = (s: Scenario, index: number) =>
  s.modifications?.[index]?.lines ??
  (index === (s.modifications?.length ?? 0) - 1 ? s.outcome?.lines : (s.sentLines ?? s.outcome?.lines)) ??
  0;

export const notOffered = async (window: Window, s: Scenario, name: string, who: Parameters<typeof signIn>[1]) => {
  const page = window.page;

  await signIn(window, who);
  await openRequest(page, name);
  await expect(page.getByRole('heading', { name: `Request ${name}` }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Edit request' }), `${who} did not raise ${name} for ${s.id}`).toHaveCount(0);
};
