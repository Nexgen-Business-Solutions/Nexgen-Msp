import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { statePath } from './state';

export type Fixture = {
  customer: string;
  password: string;
  technician: string;
  technician_secret: string;
  manager: string;
  manager_secret: string;
  administrator: string;
  administrator_secret: string;
  operator: string;
  operator_secret: string;
  requester: string;
  requester_secret: string;
  person: string;
  colleague: string;
  other_department: string;
  device: string;
  running: string;
  stopped: string;
  services: { user: string; second: string; device: string; fulfilment: string };
  request: string;
  add_request: string;
  new_person_request: string;
};

export const fixture: Fixture = JSON.parse(
  readFileSync(statePath('standard', 'fixture.json'), 'utf8')
);

/** The account whose session a spec runs under. */
export const asTechnician = { storageState: statePath('standard', 'auth', 'technician.json') };
export const asManager = { storageState: statePath('standard', 'auth', 'manager.json') };
export const asAdministrator = {
  storageState: statePath('standard', 'auth', 'administrator.json'),
};
export const asOperator = { storageState: statePath('standard', 'auth', 'operator.json') };
export const asRequester = {
  storageState: statePath('standard', 'auth', 'requester.json'),
};

/** Open a screen under the session the run signed in with. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** The vertical padding the design asks of every button, read from the browser itself. */
export async function paddingY(element: Locator) {
  return element.evaluate((node) => {
    const style = getComputedStyle(node as Element);

    return [style.paddingTop, style.paddingBottom];
  });
}

/** Where an element sits, so a test can say "this is on the right of that". */
export async function box(element: Locator) {
  const found = await element.boundingBox();

  expect(found, 'element is not visible').not.toBeNull();

  return found!;
}

export async function openHome(page: Page) {
  await page.goto('/msp');
  await page.waitForLoadState('networkidle');
}

export async function goToSection(page: Page, entry: string) {
  await page.getByRole('navigation').first().getByRole('button', { name: entry, exact: true }).click();
  await page.waitForLoadState('networkidle');
}

export async function openRequest(page: Page, name: string) {
  await openHome(page);
  await goToSection(page, 'Requests');
  await page.getByRole('textbox', { name: /^Search a request/ }).fill(name);

  const row = page.locator('tbody tr').filter({ hasText: name });

  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.locator('td').first().click();
  await expect(page.getByRole('heading', { name: new RegExp(name) }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState('networkidle');
}

export async function startWork(page: Page) {
  const start = page.getByRole('button', { name: 'Start work', exact: true });

  await expect(start, 'a request sent to Nexgen waits for the work to start').toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Continue to Execute' })).toHaveCount(0);
  await start.click();
  await expect(start).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Continue to Execute' })).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForLoadState('networkidle');
}

export async function confirmEffectiveDate(page: Page, action: string) {
  const dialog = page.getByRole('dialog');

  await expect(dialog.getByRole('heading', { name: action, exact: true })).toBeVisible();
  await expect(dialog.getByText('Billing counts from this date.')).toBeVisible();
  await expect(dialog.getByLabel('Effective date')).not.toHaveValue('');
  await dialog.getByRole('button', { name: action, exact: true }).click();
}
