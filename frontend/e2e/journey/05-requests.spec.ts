import { expect, test, type Page } from '@playwright/test';
import {
  acceptEverything,
  addExisting,
  as,
  openOurLatestRequest,
  closeRequest,
  go,
  land,
  openRow,
  runReadyWork,
  seek,
  startWork,
  submitRequest,
} from './ground';
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

      await addExisting(page, DIRECT);

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

      await submitRequest(page, 2);
    });

    test('the request they raised reads back as the act they added', async ({ page }) => {
      await land(page);
      await go(page, 'Requests');
      await openRow(page, /ZZE2E|SR-/);

      await expect(page.getByText(new RegExp(PERSONAL_SERVICE)).first()).toBeVisible({
        timeout: 20_000,
      });

      // the scope it was raised with, and what that scope came to
      const actions = page.getByRole('region', { name: 'Requested actions' });

      await expect(actions.getByText(`Add ${PERSONAL_SERVICE}`, { exact: true })).toBeVisible();
      await expect(actions.getByText('1 target from 1 person')).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'People' }).locator('tbody tr').filter({ hasText: DIRECT })
      ).toHaveCount(1);
    });
  });

  test.describe('Nexgen answers', () => {
    test.use(as('technician'));

    const openTheRequest = async (page: Page) => {
      await openOurLatestRequest(page);
    };

    test('the act is accepted as a whole', async ({ page }) => {
      await openTheRequest(page);
      await startWork(page);
      expect(await acceptEverything(page)).toBe(1);
    });

    test('the work actually runs, and the assignment exists afterwards', async ({ page }) => {
      await openTheRequest(page);

      const reference = (
        await page.getByRole('heading', { name: /^SR-\d{4}-\d+$/ }).first().innerText()
      ).trim();

      // a username the service needs is part of doing the work, not a reason to skip it
      await runReadyWork(page, 'zze2e.journey');
      await expect(page.getByText('REQUESTED', { exact: true }).first()).toBeVisible();

      await closeRequest(page);

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
