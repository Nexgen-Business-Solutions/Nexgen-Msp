import { expect, test, type Page } from '@playwright/test';
import { asAdministrator, asManager, goToSection, open, openHome } from './helpers';
import { run } from './bench';

/**
 * The reported screens, opened in a browser.
 *
 * Each case here is one a customer wrote down: the Item that would not be adopted, the draft
 * that left no trace and the machine nobody could identify. The company is the one the
 * fixture builds, and the Item is this run's own: a test deletes what it created and nothing
 * else, so the suite can be run against any site without taking a real product with it.
 */

const STAMP = `${Date.now()}`;
const ITEM = `ZZE2E-ITEM-${STAMP}`;
const ITEM_NAME = `ZZE2E Datto RMM & Managed Cyber security ${STAMP}`;

const forget = () => {
  // the guard is the point: this deletes an Item this file made up, never one somebody sells
  if (!ITEM.startsWith('ZZE2E-')) throw new Error(`${ITEM} is not this test's own Item`);

  run('frappe.db.delete', { doctype: 'MSP Service Definition', filters: { item: ITEM } });
  run('frappe.delete_doc', { doctype: 'Item', name: ITEM, force: 1 });
};

const dialog = (page: Page) => page.getByRole('dialog');

test.describe('An ERPNext Item whose month factor never moved', () => {
  test.use(asAdministrator);

  test.beforeAll(() => {
    const standing = run('frappe.db.exists', { dt: 'Item', dn: ITEM }).trim();

    // nothing is cleared away first: an Item already under this name would be somebody
    // else's, and the test stops rather than touch it
    expect(standing === '' || standing === 'None').toBeTruthy();

    run('frappe.client.insert', {
      doc: {
        doctype: 'Item',
        item_code: ITEM,
        item_name: ITEM_NAME,
        item_group: 'Services',
        stock_uom: 'Month',
        is_stock_item: 0,
        is_sales_item: 1,
        disabled: 0,
      },
    });
  });

  test.afterAll(() => {
    forget();
  });

  test('is adopted for a Device service without being called changed', async ({ page }) => {
    await open(page, '/msp/services');
    await page.getByRole('button', { name: 'Add service' }).click();

    const asked = dialog(page);

    await asked.getByRole('button', { name: /Use existing Item/ }).click();
    await asked.getByLabel('Search by Item name or code…').fill(ITEM);
    await asked.getByRole('button', { name: new RegExp(ITEM) }).first().click();

    await expect(asked.getByText('Prepare Item for MSP')).toBeVisible();

    await asked.getByRole('button', { name: 'Select a scope' }).click();
    await page.getByRole('option', { name: /^Device/ }).click();
    await asked.getByRole('button', { name: 'Apply changes & add to MSP' }).click();

    await expect(page.getByText(/changed while you were configuring/)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('tbody tr').filter({ hasText: ITEM_NAME })).toBeVisible();
  });
});

test.describe('A draft that holds nothing but a person', () => {
  test.use(asManager);

  let draft = '';

  test.afterAll(() => {
    if (draft) run('frappe.delete_doc', { doctype: 'MSP Request', name: draft, force: 1 });
  });

  test('is saved, says which record it is, and is in the address afterwards', async ({ page }) => {
    await openHome(page);
    await goToSection(page, 'Requests');
    await page.getByRole('button', { name: 'New request' }).click();
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();

    await page.getByRole('button', { name: /Existing user/ }).click();
    await page.getByLabel('Search').fill('ZZE2E Alice');
    await page.getByRole('button', { name: 'Add ZZE2E Alice' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' })).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();

    const said = page.getByText(/Draft saved — SR-/);

    await expect(said).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/[?&]draft=SR-/);

    draft = (await said.innerText()).replace(/^.*— /, '').trim();

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible();
  });
});

test.describe('The machine a person holds, in the request that will change it', () => {
  test.use(asManager);

  test('is named by hostname and serial number together', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await page.getByRole('button', { name: /Existing user/ }).click();
    await page.getByLabel('Search').fill('ZZE2E Alice');
    await page.getByRole('button', { name: 'Add ZZE2E Alice' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    const row = page.locator('tbody tr').filter({ hasText: 'ZZE2E Alice' });

    await expect(row).toContainText('ZZE2E-PC-ALICE · SN: ZZE2E-SN-PC-ALICE');

    await page.getByRole('button', { name: /Continue/ }).click();

    const detail = page.getByRole('region', { name: 'ZZE2E Alice details' });

    await expect(detail).toContainText('ZZE2E-PC-ALICE');
    await expect(detail).toContainText('ZZE2E-SN-PC-ALICE');
  });
});
