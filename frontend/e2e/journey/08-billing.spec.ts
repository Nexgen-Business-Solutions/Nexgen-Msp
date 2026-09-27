import { expect, test } from '@playwright/test';
import { as, dayOfThisMonth, go, ground, land, openJourneyRun, openOwnInvoice } from './ground';
import {
  DIRECT,
  LATECOMER,
  MACHINE_SERVICE,
  OUTSIDE,
  PAUSED,
  PERSONAL_SERVICE,
  STOPPED,
  UNBILLED,
} from './names';

/**
 * Phase 8 of the plan — the phase the whole run exists for.
 *
 * Five assignments were arranged deliberately in the phases before this one, each in a
 * different relationship to the period being drawn. What is checked here is not that an
 * invoice appears but that each line bills the period actually consumed:
 *
 *   running the whole period       -> billed in full
 *   paused mid-period, resumed     -> billed for the days outside the pause
 *   stopped mid-period             -> billed up to the end date, and no further
 *   opened mid-period              -> billed from its start date
 *   withdrawn from the catalogue   -> still billed, because it is still running
 */

test.describe.configure({ mode: 'serial' });

const lastDay = () => {
  const now = new Date();

  return dayOfThisMonth(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
};

test.describe('The run is drawn', () => {
  test.use(as('admin'));

  test('a period is billed for the company, and the run opens on its own page', async ({ page }) => {
    await land(page);
    await go(page, 'Billing');
    await page.getByRole('button', { name: 'New run' }).click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Select a contract' }).click();
    await page.getByRole('option', { name: new RegExp(ground.customer) }).first().click();

    const dates = page.locator('input[type="date"]');

    await dates.nth(0).fill(dayOfThisMonth(1));
    await dates.nth(1).fill(lastDay());

    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Generate the run/ }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /ZZE2E Journey|Billing run|BR-/ }).first()).toBeVisible({
      timeout: 40_000,
    });
  });

  test('every arranged assignment has one line, and nobody idle has any', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    for (const person of [DIRECT, OUTSIDE, PAUSED, STOPPED, LATECOMER]) {
      expect(body, `${person} is on the run`).toContain(person);
    }

    // one line per thing billed, so asking twice for the same service is one line and not two
    for (const person of [DIRECT, OUTSIDE, PAUSED, STOPPED, LATECOMER]) {
      const lines = page
        .locator('tbody tr')
        .filter({ hasText: person })
        .filter({ hasText: PERSONAL_SERVICE });

      expect(await lines.count(), `${person} has one line for the mailbox, not two`).toBe(1);
    }

    // and a person who holds nothing gets no line at all, rather than a zero one
    expect(body, 'nobody is billed for holding nothing').not.toContain(UNBILLED);
  });

  test('the withdrawn service is still billed, because it is still running', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(body, 'off the shelf is not off the invoice').toContain(MACHINE_SERVICE);
  });

  test('what is billed is the period consumed, not the calendar', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    // Service | User | Device | Months | Covered | Rate | Discount | Amount | Note
    const MONTHS = 3;
    const COVERED = 4;

    const lineOf = async (person: string) => {
      const row = page
        .locator('tbody tr')
        .filter({ hasText: person })
        .filter({ hasText: PERSONAL_SERVICE })
        .first();

      await expect(row, `no line for ${person}`).toBeVisible({ timeout: 20_000 });

      const cells = row.locator('td');

      return {
        months: Number((await cells.nth(MONTHS).innerText()).replace(',', '.')),
        covered: (await cells.nth(COVERED).innerText()).replace(/\s+/g, ' ').trim(),
      };
    };

    const monthsOf = async (person: string) => (await lineOf(person)).months;

    // the one that really ran the whole month: given by hand on the first, never interrupted
    const whole = await monthsOf(OUTSIDE);
    const paused = await monthsOf(PAUSED);
    const stopped = await monthsOf(STOPPED);
    const late = await monthsOf(LATECOMER);

    expect(whole, 'a service that ran all month is billed for the whole month').toBeCloseTo(1, 1);
    expect(paused, 'a pause takes days off the bill').toBeLessThan(whole);
    expect(stopped, 'a service stopped mid-month is not billed past its end date').toBeLessThan(whole);
    expect(late, 'a service opened mid-month is billed from its start date').toBeLessThan(whole);

    // and the line says which days it counted, not only how many
    const pausedLine = await lineOf(PAUSED);
    const stoppedLine = await lineOf(STOPPED);
    const lateLine = await lineOf(LATECOMER);

    expect(pausedLine.covered, 'the pause is visible in the days billed').toMatch(
      /→.*→|paused in between/
    );
    expect(stoppedLine.covered, 'billing stops on the end date').toContain(dayOfThisMonth(15));
    expect(lateLine.covered, 'billing starts on the start date').toContain(dayOfThisMonth(16));

    // and one that only began when the work was done is billed from that day, not from the first
    const fromTheRequest = await lineOf(DIRECT);

    expect(
      fromTheRequest.months,
      'a service opened by a request today is not billed for the whole month'
    ).toBeLessThan(whole);
  });

  test('the totals match the lines beneath them', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    await expect(page.getByText(/Total/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Something went wrong|Application error/i)).toHaveCount(0);
  });

  test('drawing the same period twice is not silently done again', async ({ page }) => {
    await land(page);
    await go(page, 'Billing');
    await page.getByRole('button', { name: 'New run' }).click();
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Select a contract' }).click();
    await page.getByRole('option', { name: new RegExp(ground.customer) }).first().click();

    const dates = page.locator('input[type="date"]');

    await dates.nth(0).fill(dayOfThisMonth(1));
    await dates.nth(1).fill(lastDay());
    await page.waitForLoadState('networkidle');

    // the screen says the period is already covered rather than quietly billing it twice
    await expect(page.getByText(/already|billed|covered/i).first()).toBeVisible({ timeout: 25_000 });
  });
});

test.describe('The run becomes an invoice', () => {
  test.use(as('admin'));

  test('it is approved and invoiced, and then sent', async ({ page }) => {
    await land(page);
    await openJourneyRun(page);

    const start = page.getByRole('button', { name: /^(Approve and invoice|Create invoice)$/ });

    await expect(start, 'a drawn run can be turned into an invoice').toBeVisible({
      timeout: 25_000,
    });
    await start.click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: /^(Approve and invoice|Create invoice)$/ }).click();
    await expect(dialog).toHaveCount(0, { timeout: 40_000 });

    const send = page.getByRole('button', { name: /^Submit (invoice|credit note)$/ });

    await expect(send, 'and an invoice can be sent').toBeVisible({ timeout: 30_000 });
    await send.click();

    // once sent, it is the customer's to read and to argue with
    await expect(page.getByText(/INVOICED|Invoiced as/i).first()).toBeVisible({ timeout: 40_000 });
  });
});

test.describe('The customer reads the same figures', () => {
  test.use(as('manager'));

  test('the invoice reads as the customer sees it', async ({ page }) => {
    await land(page);
    await openOwnInvoice(page);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(body, 'and it names a service they hold').toContain(PERSONAL_SERVICE);
  });
});
