import { expect, test, type Page } from '@playwright/test';
import {
  acceptEverything,
  addExisting,
  as,
  openOurLatestRequest,
  createPerson,
  go,
  land,
  openRow,
  pickScope,
  runReadyWork,
  seek,
  startWork,
  submitRequest,
} from './ground';
import { DIRECT, GROUP_DROPPED, GROUP_KEPT, PERSONAL_SERVICE, SECOND } from './names';

/**
 * A Department asked for as a whole, minus one person.
 *
 * Two people are named one by one, then a whole Department is loaded on top. One person of that
 * Department is then left out of the act — not out of the Department, and not out of the
 * request: they stay on the People table, they simply are not a target of this service.
 *
 * What the run proves is that the act reaches exactly the people who were kept, that the one
 * who was unticked ends up with no line and no assignment, and that they are still where they
 * were. The Department is its own, so nothing here depends on how other phases arranged theirs.
 */

test.describe.configure({ mode: 'serial' });

const DEPARTMENT = 'Logistics';

test.describe('The Department this scenario needs', () => {
  test.use(as('admin'));

  test('three people are put in it', async ({ page }) => {
    for (const person of [...GROUP_KEPT, GROUP_DROPPED]) {
      await createPerson(page, person, DEPARTMENT);
      await expect(page.getByText(person).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});

test.describe('A Department, minus one', () => {
  test.use(as('manager'));

  // one test, because the draft lives in the page: a second test gets a new window and the
  // builder it was halfway through is gone
  test('two named, the Department loaded on top, and one of them left out of the act', async ({
    page,
  }) => {
    await land(page);
    await go(page, 'Requests');
    await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
    await page.waitForLoadState('networkidle');

    for (const person of [DIRECT, SECOND]) await addExisting(page, person);

    await page.getByRole('button', { name: 'Department', exact: true }).click();

    const loader = page.getByRole('dialog');

    await loader.getByRole('button', { name: /Select|Department/ }).first().click();
    await page.getByRole('option', { name: new RegExp(DEPARTMENT) }).first().click();
    await loader.getByRole('button', { name: 'Load Department' }).click();
    await expect(loader).toHaveCount(0, { timeout: 20_000 });

    for (const person of [DIRECT, SECOND, ...GROUP_KEPT, GROUP_DROPPED]) {
      await expect(
        page.locator('tbody tr').filter({ hasText: person }),
        `${person} is on the People table`
      ).toHaveCount(1);
    }

    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: DIRECT, exact: true })).toBeVisible({ timeout: 20_000 });
    await pickScope(page, /^All selected/);
    await expect(page.getByRole('heading', { name: 'All selected people' })).toBeVisible();

    const card = page
      .locator('tbody tr')
      .filter({ hasText: PERSONAL_SERVICE })
      .filter({ hasText: /Add · \d+/ })
      .last();

    await card.getByRole('button', { name: /^Add · \d+$/ }).click();

    const impact = page.getByRole('dialog');

    await expect(impact.getByText(/\d+ of \d+ people are applicable/)).toBeVisible({
      timeout: 20_000,
    });

    // untick the one who must not receive it: the box is named after the person
    const drop = impact.getByLabel(`Include ${GROUP_DROPPED}`);

    await expect(drop, `${GROUP_DROPPED} is offered, and can be left out`).toBeVisible();
    await drop.uncheck();

    await impact.getByRole('button', { name: 'Add action' }).click();
    await expect(impact).toHaveCount(0, { timeout: 20_000 });

    // still in the request: the People step is where the subjects live, so that is where it is
    // checked — leaving somebody out of an act is not removing them from the request
    await page.getByRole('button', { name: /^People · \d+$/ }).click();
    await expect(
      page.locator('tbody tr').filter({ hasText: GROUP_DROPPED }),
      'leaving somebody out of an act does not take them out of the request'
    ).toHaveCount(1);

    await submitRequest(page, 3);
  });
});

test.describe('And the work reaches exactly them', () => {
  test.use(as('technician'));

  const openLatest = async (page: Page) => {
    await openOurLatestRequest(page);
  };

  test('the lines are the kept people, and only them', async ({ page }) => {
    await openLatest(page);
    await startWork(page);

    const actions = page.getByRole('region', { name: 'Requested actions' });

    await expect(actions.getByRole('button', { name: 'Accept all' })).toBeVisible({ timeout: 25_000 });

    for (const person of GROUP_KEPT) {
      await expect(
        actions.locator('tbody tr').filter({ hasText: person }),
        `${person} has a line to decide on`
      ).toHaveCount(1);
    }

    await expect(
      actions.locator('tbody tr').filter({ hasText: GROUP_DROPPED }),
      `${GROUP_DROPPED} was left out, so there is no line for them`
    ).toHaveCount(0);

    expect(await acceptEverything(page)).toBeGreaterThanOrEqual(GROUP_KEPT.length);
  });

  test('the service lands on the kept people and not on the one left out', async ({ page }) => {
    await openLatest(page);
    await runReadyWork(page, 'zze2e.group');

    for (const person of GROUP_KEPT) {
      await go(page, 'Users');
      await openRow(page, person);

      await expect(
        page.locator('tbody tr').filter({ hasText: PERSONAL_SERVICE }).first(),
        `${person} was kept, so they hold the service`
      ).toBeVisible({ timeout: 25_000 });
    }

    await go(page, 'Users');
    await openRow(page, GROUP_DROPPED);

    await expect(
      page.locator('tbody tr').filter({ hasText: PERSONAL_SERVICE }),
      `${GROUP_DROPPED} was left out of the act, so they hold nothing`
    ).toHaveCount(0);
    await expect(page.getByText(/No service assignment is recorded/)).toBeVisible();
  });

  test('and the one left out is still in the same Department', async ({ page }) => {
    await land(page);
    await go(page, 'Users');
    await seek(page, GROUP_DROPPED);

    // the point was never to move them out of the group: one service passed them by, that is all
    await expect(
      page.locator('tbody tr').filter({ hasText: GROUP_DROPPED }).first()
    ).toContainText(new RegExp(DEPARTMENT));
  });
});
