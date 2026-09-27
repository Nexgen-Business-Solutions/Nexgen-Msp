import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

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
  readFileSync(new URL('./.fixture.json', import.meta.url), 'utf8')
);

/** The account whose session a spec runs under. */
export const asTechnician = { storageState: new URL('./.auth/technician.json', import.meta.url).pathname };
export const asManager = { storageState: new URL('./.auth/manager.json', import.meta.url).pathname };
export const asAdministrator = {
  storageState: new URL('./.auth/administrator.json', import.meta.url).pathname,
};
export const asOperator = { storageState: new URL('./.auth/operator.json', import.meta.url).pathname };

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
