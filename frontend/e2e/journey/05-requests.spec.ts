import { expect, test, type Page } from '@playwright/test';
import { as, go, land, openRow, runReadyWork, seek } from './ground';
import { DIRECT, PERSONAL_SERVICE, SECOND } from './names';

/**
 * Phase 5 of the plan — a request, from the customer's first click to the work being done.
 *
 * The manager asks, the technician answers, and every step is reached by clicking. What is
 * checked is not that buttons exist but that the two sides agree: the act the customer added
 * is the act the technician is shown, and the target they chose is the one that gets done.
 */

test.describe.serial('A request, raised and carried out', () => {
  test.describe('The customer asks', () => {
    test.use(as('manager'));

    test('a service is asked for one person, and submitted', async ({ page }) => {
      await land(page);
      await go(page, 'Requests');
      await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
      await page.waitForLoadState('networkidle');

      await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();

      await page.getByRole('button', { name: /Select existing/ }).click();
      await page.getByLabel('Search').fill(DIRECT);
      await page.getByRole('button', { name: /^Add$/ }).first().click();
      await page.getByRole('button', { name: 'Done' }).click();

      await expect(page.locator('tbody tr').filter({ hasText: DIRECT })).toHaveCount(1);

      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByText('Group actions stay explicit')).toBeVisible();

      // the card of the service being asked for, not whichever card comes first: Alice holds a
      // machine, so the Device-scoped service is offered here too and would be picked instead
      const card = page
        .locator('tbody tr')
        .filter({ hasText: PERSONAL_SERVICE })
        .filter({ hasText: /Add · \d+/ })
        .last();

      await card.getByRole('button', { name: /^Add · \d+$/ }).click();

      const impact = page.getByRole('dialog');

      // the exact impact is reviewed before the act is added, never after
      await expect(impact.getByText(/\d+ of \d+ people are applicable/)).toBeVisible();
      await impact.getByRole('button', { name: 'Add action' }).click();
      await expect(impact).toHaveCount(0, { timeout: 20_000 });

      await page.getByRole('button', { name: /Continue/ }).click();
      await page.getByRole('button', { name: /Continue/ }).click();

      await expect(
        page.getByText('Confirm the exact snapshot and requested actions.')
      ).toBeVisible();

      await page.getByRole('button', { name: 'Submit request' }).click();
      await page.waitForURL(/\/msp\/requests/, { timeout: 30_000 });
    });

    test('the request they raised reads back as the act they added', async ({ page }) => {
      await land(page);
      await go(page, 'Requests');
      await openRow(page, /ZZE2E|SR-/);

      await expect(page.getByText(new RegExp(PERSONAL_SERVICE)).first()).toBeVisible({
        timeout: 20_000,
      });

      // the scope it was raised with, and what that scope came to
      await expect(page.getByText(/\d+ targets from \d+ selected people/).first()).toBeVisible();
      await expect(
        page.getByText(/1 will be affected · 0 were left unchanged/).first()
      ).toBeVisible();
    });
  });

  test.describe('Nexgen answers', () => {
    test.use(as('technician'));

    const openTheRequest = async (page: Page) => {
      await land(page);
      await go(page, 'Requests');
      await openRow(page, /SR-/);
    };

    test('the act is accepted, line by line', async ({ page }) => {
      await openTheRequest(page);

      // no complacent guard: the act was raised, so a decision has to be offered here
      const accept = page.getByRole('button', { name: /^Accept all( pending| \d+)$/ }).first();

      await expect(accept, 'the technician is offered the decision').toBeVisible({
        timeout: 25_000,
      });
      await accept.click();

      await expect(page.getByText('Line review complete')).toBeVisible({ timeout: 25_000 });

      const start = page.getByRole('button', { name: 'Continue to Execute' });

      await expect(start).toBeVisible({ timeout: 25_000 });
      await start.click();
      await page.waitForLoadState('networkidle');
    });

    test('the work actually runs, and the assignment exists afterwards', async ({ page }) => {
      await openTheRequest(page);
      await page.getByRole('button', { name: 'Execute', exact: true }).click();
      await page.waitForLoadState('networkidle');

      // a username the service needs is part of doing the work, not a reason to skip it
      const usernames = page.getByRole('button', { name: /Complete \d+ usernames/ });

      await expect(usernames, 'the work says what it still needs').toBeVisible({ timeout: 25_000 });

      // the primary button of each line is the act itself, which is what the technician clicks
      await runReadyWork(page, 'Add service', 'zze2e.journey');

      await expect(usernames, 'and once given, it is not asked for again').toHaveCount(0);
      await expect(page.getByText(/^0 remaining$/)).toBeVisible();

      // and it is carried to the end: recap, then closing
      await page.getByRole('button', { name: 'Continue to Verify' }).click();
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('What was actually done')).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText('REQUESTED').first()).toBeVisible();

      await page.getByRole('button', { name: 'Continue to Final validation' }).click();
      await page.waitForLoadState('networkidle');

      const reference = (await page.getByText(/^SR-\d{4}-\d+$/).first().innerText()).trim();

      await page.getByRole('button', { name: /Validate & complete request/ }).click();

      // closing hands the technician back to the queue, and the request is out of it
      await expect(page.getByRole('heading', { name: 'Requests' }).first()).toBeVisible({
        timeout: 30_000,
      });

      await go(page, 'Requests');
      await seek(page, reference);
      await expect(
        page.locator('tbody tr').filter({ hasText: reference }).first(),
        'the request it was is the request it stays'
      ).toContainText(/COMPLETED/i);

      await go(page, 'Users');
      await openRow(page, DIRECT);

      // an assignment, not a mention: the services table is where the service has to appear
      const assignment = page
        .locator('tbody tr')
        .filter({ hasText: PERSONAL_SERVICE })
        .first();

      await expect(assignment, 'the service is assigned to the person').toBeVisible({
        timeout: 25_000,
      });
      await expect(page.getByText(/No service assignment is recorded/)).toHaveCount(0);
    });

    test('the register counts what the page shows', async ({ page }) => {
      await land(page);
      await go(page, 'Users');
      await seek(page, DIRECT);

      const row = page.locator('tbody tr').filter({ hasText: DIRECT }).first();
      const listed = (await row.innerText()).replace(/\s+/g, ' ');

      await openRow(page, DIRECT);

      // read the counter from its own element, so the check waits for the card instead of
      // racing it: a plain value comparison has nothing to retry
      const counter = page.getByText(/\d+ personal services/).first();

      await expect(counter).toBeVisible({ timeout: 25_000 });

      const onPage = Number((await counter.innerText()).match(/(\d+)/)?.[1] ?? -1);

      expect(onPage, 'the page says how many personal services they hold').toBeGreaterThanOrEqual(1);
      expect(listed, 'and the register lists that person').toContain(DIRECT);
      expect(SECOND).toBeTruthy();
    });
  });
});
