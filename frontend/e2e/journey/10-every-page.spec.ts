import { expect, test, type Page } from '@playwright/test';
import { as, go, ground, land, openRow, opensCleanly } from './ground';
import { DIRECT, LAPTOP, MACHINE_SERVICE } from './names';

/**
 * Phase 10 of the plan — every screen, once, as each role that is allowed it.
 *
 * A page that throws in production throws here too, and a run that only ever looks at the one
 * table it came for walks straight past it. So each entry in the menu is clicked, each listing
 * is opened on one of its own rows, and each of them has to render its own heading rather than
 * an error boundary or an empty frame where rows exist.
 */

test.describe.configure({ mode: 'serial' });

const BROKEN = /Something went wrong|Application error|Unexpected error|Failed to fetch/i;

/** Click a menu entry, prove the screen came up, and prove nothing blew up behind it. */
const sweep = async (page: Page, entry: string, heading: RegExp) => {
  await go(page, entry);
  await opensCleanly(page, heading);
  await expect(page.getByText(BROKEN)).toHaveCount(0);
};

test.describe('Every screen an administrator is given', () => {
  test.use(as('admin'));

  test('each entry in the menu opens its own screen', async ({ page }) => {
    await land(page);

    await sweep(page, 'Requests', /Requests/);
    await sweep(page, 'Users', /Users/);
    await sweep(page, 'Devices', /Devices/);
    await sweep(page, 'Services', /Services/);
    await sweep(page, 'Customers', /Customers/);
    await sweep(page, 'Billing', /Billing/);
    await sweep(page, 'Activity', /Activity/);
    await sweep(page, 'Accounts', /Accounts/);
    await sweep(page, 'Settings', /Settings/);
    await sweep(page, 'Dashboard', /Dashboard|Overview/);
  });

  test('each listing opens one of its own rows without breaking', async ({ page }) => {
    const rows: [string, string | RegExp, RegExp][] = [
      ['Users', DIRECT, new RegExp(DIRECT)],
      ['Devices', LAPTOP, new RegExp(LAPTOP)],
      ['Services', MACHINE_SERVICE, new RegExp(MACHINE_SERVICE)],
      // a service request, found by the person it names: the newest request is the dispute, and
      // opening a dispute rightly takes you to the invoice it argues with, not to a request page
      ['Requests', DIRECT, /SR-|Request/],
      ['Billing', /BR-/, /BR-|Billing run|ZZE2E/],
      ['Accounts', /jadmin|ZZE2E/, /jadmin|ZZE2E|Account/],
    ];

    for (const [entry, row, heading] of rows) {
      await land(page);
      await go(page, entry);
      await openRow(page, row);

      // say which screen is at fault, and where the run actually ended up: a sweep that only
      // reports a missing heading sends you looking on the wrong page
      await expect(
        page.getByRole('heading', { name: heading }).first(),
        `${entry} detail did not render its own heading — the run is at ${page.url()}`
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(BROKEN), `${entry} detail broke`).toHaveCount(0);
    }
  });

  test('the company reads as one screen: its counters, its contract and its rates', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Customers');
    await openRow(page, ground.customer);

    // read it once it is there: the register's own heading says Customers either way
    await expect(page.getByRole('heading', { name: new RegExp(ground.customer) }).first()).toBeVisible({
      timeout: 25_000,
    });

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    // the two old screens are one now, so all three have to be on it
    expect(body, 'the counters are there').toMatch(/\d+\s*(people|users)/i);
    expect(body, 'the contract is there').toMatch(/Contract|contract/);
    expect(body, 'and so are the rates').toMatch(/Rate|rate/);
  });
});

test.describe('Every screen a technician is given', () => {
  test.use(as('technician'));

  test('what is theirs opens, and what is not is not offered', async ({ page }) => {
    await land(page);

    await sweep(page, 'Requests', /Requests/);
    await sweep(page, 'Users', /Users/);
    await sweep(page, 'Devices', /Devices/);

    const sidebar = page.getByRole('navigation').first();

    // the catalogue and the billing are an administrator's screens, and a door that is not
    // theirs is better not shown than shown and refused
    await expect(sidebar.getByRole('button', { name: 'Services', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Billing', exact: true })).toHaveCount(0);
  });
});

test.describe('Every screen the customer is given', () => {
  test.use(as('manager'));

  test('the manager walks their own file end to end', async ({ page }) => {
    await land(page);

    await sweep(page, 'Requests', /Requests/);
    await sweep(page, 'Users', /Users|People/);
    await sweep(page, 'Devices', /Devices|Machines/);
    // the customer's own word for it: they read invoices, we draw billing runs
    await sweep(page, 'Invoices', /Invoices/);
    await sweep(page, 'Services', /Services/);
  });

  test('the operator reads the same file and is offered nothing to raise', async ({ browser }) => {
    const context = await browser.newContext(as('operator'));
    const page = await context.newPage();

    await land(page);
    await sweep(page, 'Users', /Users|People/);
    await sweep(page, 'Devices', /Devices|Machines/);

    await go(page, 'Requests');
    await expect(
      page.getByRole('button', { name: /New request|Raise a request/ })
    ).toHaveCount(0);

    await context.close();
  });
});
