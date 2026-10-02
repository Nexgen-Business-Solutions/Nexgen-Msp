import { readFileSync, writeFileSync } from 'node:fs';
import { request as playwrightRequest, expect, type Page } from '@playwright/test';
import { run } from '../bench';
import { statePath } from '../state';
import { totp } from '../totp';

const BASE = process.env.MSP_BASE_URL ?? 'http://msp.localhost:8000';
export const FILE = statePath('journey', 'journey.json');

export type Ground = {
  customer: string;
  password: string;
  departments: string[];
  admin: string;
  admin_secret: string;
  technician: string;
  technician_secret: string;
  manager: string;
  manager_secret: string;
  operator: string;
  operator_secret: string;
  requester: string;
  requester_secret: string;
};

/** Everybody the journey signs in as. */
export type Who = 'admin' | 'technician' | 'manager' | 'operator' | 'requester';

/** The company and the four ways in — the only two things a browser cannot make for itself. */
export const buildGround = async (): Promise<Ground> => {
  // whatever an interrupted or deliberately kept run left behind goes first: the journey
  // builds its company from nothing, or it is not building the company it then checks
  run('nexgen_msp.utils.e2e_fixture.journey_teardown');

  const printed = run('nexgen_msp.utils.e2e_fixture.journey_ground');
  const ground = JSON.parse(
    printed.slice(printed.indexOf('{'), printed.lastIndexOf('}') + 1)
  ) as Ground;

  for (const who of ['admin', 'technician', 'manager', 'operator', 'requester'] as const) {
    const context = await playwrightRequest.newContext({ baseURL: BASE });
    const first = await context.post('/api/method/nexgen_msp.api.auth.endpoints.v1.pre_login', {
      form: { username: ground[who], password: ground.password },
    });

    if (!first.ok()) throw new Error(`${who}: ${await first.text()}`);

    const pending = (await first.json()).message;
    const second = await context.post(
      '/api/method/nexgen_msp.api.auth.endpoints.v1.complete_login',
      {
        form: {
          pending_token: pending.pending_token,
          otp: totp(ground[`${who}_secret`]),
          username: ground[who],
        },
      }
    );

    if (!second.ok()) throw new Error(`${who}: ${await second.text()}`);

    await context.storageState({
      path: statePath('journey', 'auth', `${who}.json`),
    });
    await context.dispose();
  }

  writeFileSync(FILE, JSON.stringify(ground, null, 2));

  return ground;
};

export const tearDownGround = () => run('nexgen_msp.utils.e2e_fixture.journey_teardown');

export const ground: Ground = (() => {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8')) as Ground;
  } catch {
    return {} as Ground;
  }
})();

export const as = (who: Who) => ({
  storageState: statePath('journey', 'auth', `${who}.json`),
});

/**
 * The one address the run is allowed to type: you have to arrive somewhere.
 *
 * Everything after this is reached by clicking, because a menu that stops working is a fault
 * a run which types addresses would never notice.
 */
export const land = async (page: Page) => {
  await page.goto('/msp');
  await page.waitForLoadState('networkidle');
};

/** Walk to a section the way a person does: by clicking its entry in the sidebar. */
export const go = async (page: Page, entry: string) => {
  const sidebar = page.getByRole('navigation').first();

  await sidebar.getByRole('button', { name: entry, exact: true }).click();
  await page.waitForLoadState('networkidle');
};

/**
 * Narrow a long listing the way a person does: by typing in its search box.
 *
 * Every register here holds hundreds of rows and shows one page of them, so a run that only
 * looks at what happens to be on screen is reading the alphabet, not the data.
 */
export const seek = async (page: Page, text: string) => {
  const box = page.getByRole('textbox', { name: /Search/i }).first();

  if (await box.count()) {
    await box.fill(text);
    await page.waitForLoadState('networkidle');
  }

  await expect(
    page.locator('tbody tr').filter({ hasText: text }).first(),
    `no row for ${text}`
  ).toBeVisible({ timeout: 20_000 });
};

/** Open a record from the listing that names it, the way a person opens a row. */
export const openRow = async (page: Page, text: string | RegExp) => {
  if (typeof text === 'string') await seek(page, text);

  const row = page.locator('tbody tr').filter({ hasText: text }).first();

  await expect(row, `no row for ${text}`).toBeVisible({ timeout: 20_000 });

  // the control that carries the record's own name; some listings make the whole row
  // clickable instead, and then the cell holding the name is what a person clicks
  const named = row.getByRole('button', { name: text }).first();

  if (await named.count()) {
    await named.click();
  } else {
    await row.locator('td').first().click();
  }

  await page.waitForLoadState('networkidle');
};

export const openOurLatestRequest = async (page: Page) => {
  await land(page);
  await go(page, 'Requests');
  await seek(page, ground.customer);
  await page.locator('tbody tr').filter({ hasText: ground.customer }).first().locator('td').first().click();
  await expect(page.getByRole('heading', { name: /^(Request )?SR-\d{4}-\d+$/ }).first()).toBeVisible({
    timeout: 25_000,
  });
  await page.waitForLoadState('networkidle');
};

/** Register a person, the one door every later phase needs before it can ask for anything. */
export const createPerson = async (page: Page, name: string, department: string) => {
  await land(page);
  await go(page, 'Users');
  await page.getByRole('button', { name: 'New user' }).click();

  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Select a customer' }).click();
  await page.getByRole('option', { name: new RegExp(ground.customer) }).first().click();

  await dialog.getByPlaceholder('Marie Dupont').fill(name);

  await dialog.getByRole('button', { name: 'Select department' }).click();
  await page.getByRole('option', { name: new RegExp(department) }).first().click();

  await dialog.getByRole('button', { name: /Create and open/ }).click();
  await page.waitForLoadState('networkidle');
};

/** A date inside the period the billing phase draws, as the forms want it. */
export const dayOfThisMonth = (day: number) => {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * Open the journey's own billing run.
 *
 * The register sorts by the period a run covers, so the newest run is not the topmost one and
 * a run belonging to another company would be opened instead. The company's name is what
 * narrows it down.
 */
export const openJourneyRun = async (page: Page) => {
  await go(page, 'Billing');
  await seek(page, ground.customer);

  // the row is found by the company, but it is opened by its own reference, which is the name
  // the register makes clickable
  // the screen also carries a panel of periods still to bill, whose rows name the company but
  // hold no reference: the run is the row that has both
  const row = page
    .locator('tbody tr')
    .filter({ hasText: ground.customer })
    .filter({ hasText: /BR-/ })
    .first();
  // bounded on purpose: innerText runs the reference straight into the badge beside it, and a
  // greedy match would come back with "BR-2026-09-641DISPUTED"
  const reference = (await row.innerText()).match(/BR-\d{4}-\d{2}-\d+/)?.[0];

  expect(reference, 'the company has a run to open').toBeTruthy();

  await openRow(page, reference as string);
  await expect(page.getByRole('heading', { name: /^BR-/ }).first()).toBeVisible({
    timeout: 25_000,
  });
};

/**
 * The same invoice, opened the way the customer opens it.
 *
 * Their register is called Invoices and holds only their own company, so there is nothing to
 * narrow down — the run is simply there.
 */
export const openOwnInvoice = async (page: Page) => {
  await go(page, 'Invoices');

  // their register names the invoice, not the run behind it: that is the reference they would
  // quote to us, so it is the one the run clicks
  await openRow(page, /-SINV-/);
  await expect(page.getByRole('heading', { name: /-SINV-|^BR-/ }).first()).toBeVisible({
    timeout: 25_000,
  });
};

export const startWork = async (page: Page) => {
  const start = page.getByRole('button', { name: 'Start work', exact: true });

  await expect(start, 'a request sent to Nexgen waits for the work to start').toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByRole('button', { name: 'Continue to Execute' })).toHaveCount(0);
  await start.click();
  await expect(start).toHaveCount(0, { timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Continue to Execute' })).toBeVisible({
    timeout: 25_000,
  });
  await page.waitForLoadState('networkidle');
};

export const acceptEverything = async (page: Page) => {
  const actions = page.getByRole('region', { name: 'Requested actions' });
  const open = actions.locator('button:enabled', { hasText: 'Accept all' });
  const single = actions.getByRole('button', { name: 'Accept', exact: true });
  const remaining = page.getByText(/^\d+ decisions? remaining$/);

  await expect(remaining, 'the review offers a decision per action group').toBeVisible({
    timeout: 25_000,
  });

  const expected = Number(((await remaining.textContent()) ?? '').split(' ')[0]);

  expect(expected, 'there are lines to decide on').toBeGreaterThan(0);

  const left = async () =>
    (await remaining.count()) ? Number(((await remaining.first().textContent()) ?? '0').split(' ')[0]) : 0;

  for (const buttons of [open, single]) {
    while ((await left()) > 0 && (await buttons.count())) {
      const before = await left();

      await buttons.first().click();
      await expect.poll(left, { timeout: 25_000 }).toBeLessThan(before);
    }
  }

  await expect(page.getByText(`${expected} accepted · 0 rejected`)).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Continue to Execute' }).click();
  await expect(page.getByRole('heading', { name: 'Execute', exact: true })).toBeVisible({
    timeout: 25_000,
  });
  await page.waitForLoadState('networkidle');

  return expected;
};

export const runReadyWork = async (page: Page, usernames: string | null) => {
  await page
    .getByRole('complementary', { name: 'Execution view' })
    .getByRole('button', { name: /^All remaining work/ })
    .click();

  const owed = page.getByRole('button', { name: /^Complete \d+ usernames$/ });

  if (usernames) {
    await expect(owed, 'the work says which usernames it still needs').toBeVisible({ timeout: 25_000 });
    await owed.click();

    const dialog = page.getByRole('dialog');
    const fields = dialog.getByRole('textbox', { name: /^Username for / });

    await expect(fields.first()).toBeVisible();

    for (const [index, box] of (await fields.all()).entries()) {
      await box.fill(`${usernames}${index + 1}`);
    }

    await dialog.getByRole('button', { name: 'Save & continue' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });
  }

  await expect(owed, 'no username is left to give').toHaveCount(0, { timeout: 25_000 });

  const ready = page.getByRole('button', { name: /^Execute \d+ ready$/ });

  await expect(ready).toBeVisible({ timeout: 25_000 });

  const action = ((await ready.textContent()) ?? '').trim();

  await ready.click();

  const dating = page.getByRole('dialog');

  await expect(dating.getByRole('heading', { name: action, exact: true }), 'the work asks for its effective date first').toBeVisible();
  await expect(dating.getByLabel('Effective date')).not.toHaveValue('');
  await dating.getByRole('button', { name: action, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Execution recap' }), 'every accepted line was carried out').toBeVisible({
    timeout: 40_000,
  });
};

export const closeRequest = async (page: Page) => {
  await page.getByRole('button', { name: 'Continue to Final validation' }).click();
  await expect(page.getByText('READY TO COMPLETE', { exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Validate & complete request' }).click();
  await expect(page.getByRole('button', { name: 'Refresh' }).first()).toBeVisible({ timeout: 30_000 });
};

export const submitRequest = async (page: Page, steps: number) => {
  for (let step = 0; step < steps; step += 1) {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'Review request' })).toBeVisible({ timeout: 25_000 });
  await expect(
    page.getByText('Confirm the exact snapshot and requested actions before submission.')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('button', { name: 'New request' })).toBeVisible({ timeout: 30_000 });
};

export const approveFromBar = async (page: Page) => {
  await expect(page.getByText('Internal approval required')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Approve and send to Nexgen' }).click();
  await expect(page.getByText('Internal approval required')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Request information' })).toContainText(
    /Approved · /
  );
};

export const refuseFromBar = async (page: Page, reason: string) => {
  await expect(page.getByText('Internal approval required')).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Reject', exact: true }).click();

  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Reject request' });

  await expect(confirm, 'a refusal with no reason is not a refusal').toBeDisabled();
  await dialog.getByLabel('Reason *').fill(reason);
  await confirm.click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Internal approval required')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('REJECTED', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(reason).first()).toBeVisible();
};

export const pickScope = async (page: Page, entry: RegExp) => {
  const rail = page.locator('aside').filter({ hasText: 'Apply actions to' });

  await rail.getByRole('button', { name: entry }).click();
  await expect(rail.getByRole('button', { name: entry })).toHaveAttribute('aria-current', 'true');
};

export const addExisting = async (page: Page, person: string) => {
  await page.getByRole('button', { name: /Existing user/ }).click();

  const dialog = page.getByRole('dialog');

  await dialog.getByLabel('Search').fill(person);
  await dialog.getByRole('button', { name: `Add ${person}` }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('tbody tr').filter({ hasText: person })).toHaveCount(1);
};

/**
 * Open a screen and prove it rendered itself rather than an error.
 *
 * A page that throws in production throws here too, and a run that only ever looks at the
 * one table it came for will walk straight past it.
 */
export const opensCleanly = async (page: Page, heading: RegExp | string) => {
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Something went wrong|Application error|Unexpected error/i)).toHaveCount(
    0
  );
};

/** What the server says about one record, for comparing a listing against a detail page. */
export const readFacts = (method: string) => JSON.parse(run(method));
