import { expect, test } from '@playwright/test';
import { as, land, openJourneyRun, openOwnInvoice } from './ground';

/**
 * Phase 9 of the plan — the dispute.
 *
 * The customer says the invoice is wrong; Nexgen reads it, answers it, and the invoice itself
 * is left exactly as it was. A dispute is a conversation about an invoice, not an edit to one.
 */

test.describe.configure({ mode: 'serial' });

const REASON = 'ZZE2E journey: two of these people left mid-period and are still billed';

test.describe('The customer disputes', () => {
  test.use(as('manager'));

  test('a dispute with no reason is refused', async ({ page }) => {
    await land(page);
    await openOwnInvoice(page);

    await page.getByRole('button', { name: 'Dispute this invoice' }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog.getByRole('button', { name: /Send the dispute/ })).toBeDisabled();
    await dialog.getByRole('button', { name: /^Cancel$/ }).click();
  });

  test('with a reason, it is raised and the invoice says so', async ({ page }) => {
    await land(page);
    await openOwnInvoice(page);

    await page.getByRole('button', { name: 'Dispute this invoice' }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder(/still being billed/).fill(REASON);
    await dialog.getByRole('button', { name: /Send the dispute/ }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });

    await expect(page.getByText(/You disputed this invoice/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(REASON)).toBeVisible();
  });
});

test.describe('Nexgen answers it', () => {
  test.use(as('admin'));

  test('the dispute names the invoice and the reason it was raised for', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(body, 'the reason the customer typed reaches us verbatim').toContain(REASON);
  });

  test('it is settled, and the invoice is left as it was', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    const before = await page
      .getByText(/Total/i)
      .first()
      .innerText();

    await page.getByRole('button', { name: 'Settle the dispute' }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('textbox').first().fill('ZZE2E journey: checked, the periods are right');
    await dialog.getByRole('button', { name: 'Settle', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });

    await expect(page.getByRole('button', { name: 'Settle the dispute' })).toHaveCount(0);

    const after = await page
      .getByText(/Total/i)
      .first()
      .innerText();

    expect(after, 'settling a dispute does not rewrite the invoice').toBe(before);
  });
});

test.describe('And the customer sees the outcome', () => {
  test.use(as('manager'));

  test('the invoice carries what came of it', async ({ page }) => {
    await land(page);
    await openOwnInvoice(page);

    // the episode stays on the invoice once it is answered: what they said, and what we replied
    await expect(page.getByText(/You disputed this invoice/)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(REASON)).toBeVisible();
    await expect(page.getByText(/^Settled$/)).toBeVisible();
    await expect(page.getByText(/the periods are right/)).toBeVisible();

  });
});
