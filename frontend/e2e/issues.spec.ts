import { expect, test, type Page } from '@playwright/test';
import { asAdministrator, asManager, goToSection, open, openHome } from './helpers';
import { run } from './bench';

/**
 * The reported screens, opened in a browser.
 *
 * Each case here is one a customer wrote down: the Item that would not be adopted, the draft
 * that left no trace, the machine nobody could identify and the count nobody could explain.
 * The company these read is the one the fixture builds, except where the report is about a
 * real company's records — then that company is read as it stands, and nothing is saved.
 */

const ITEM = '9000-0092';
const ITEM_NAME = 'Datto RMM & Managed Cyber security solution';
const KAKIVU = 'Kakivu Mousse USD';

const forget = () => {
  run('frappe.db.delete', { doctype: 'MSP Service Definition', filters: { item: ITEM } });

  try {
    run('frappe.delete_doc', { doctype: 'Item', name: ITEM, force: 1 });
  } catch {
    // nothing of this Item was left behind
  }
};

const dialog = (page: Page) => page.getByRole('dialog');

test.describe('An ERPNext Item whose month factor never moved', () => {
  test.use(asAdministrator);

  test.beforeAll(() => {
    forget();
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

test.describe('Twenty-two people, twenty machines, and the difference explained', () => {
  test.use(asAdministrator);

  test('names who is left out of a Device service and why, before anything is added', async ({
    page,
  }) => {
    await open(page, '/msp/requests/new');

    await page.getByRole('button', { name: /Acting for which customer/ }).click();
    await page.getByRole('listbox').getByPlaceholder('Search…').fill('Kakivu');
    await page.getByRole('option', { name: KAKIVU }).click();

    await page.getByRole('button', { name: /Entire company/ }).click();
    await page.getByRole('button', { name: 'Add entire company' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(22, { timeout: 30_000 });

    await page.getByRole('button', { name: /Continue/ }).click();
    await page
      .locator('aside')
      .filter({ hasText: 'Apply actions to' })
      .getByRole('button', { name: /^All selected/ })
      .click();

    const service = page.locator('tbody tr').filter({ hasText: 'Sophos' }).first();

    await expect(service).toContainText('22 people selected · 20 linked devices');
    await expect(service).toContainText('2 people without a linked device');

    await service.getByRole('button', { name: 'Why only 20?' }).first().click();

    const why = dialog(page);

    await expect(why.getByText('Why only 20?')).toBeVisible();
    await expect(why).toContainText('NAWAZDDINE (Stolen PC)');
    await expect(why).toContainText('Firdosh Samnani');
    await expect(why).toContainText('Person has no current Device.');
    await expect(why).toContainText('NO_CURRENT_DEVICE');
    await expect(why.getByRole('link', { name: 'Devices' })).toBeVisible();

    // not one of this company's machines carries a serial number, and that is said rather
    // than left blank
    await expect(why).toContainText('Serial number not recorded');

    await why.getByRole('button', { name: 'Done' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});
