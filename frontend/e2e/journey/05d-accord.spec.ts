import { expect, test, type Page } from '@playwright/test';
import {
  addExisting,
  approveFromBar,
  as,
  createPerson,
  go,
  land,
  openRow,
  refuseFromBar,
  submitRequest,
} from './ground';
import { ACCORD_ONE, ACCORD_TWO, PERSONAL_SERVICE } from './names';

/**
 * Phase 5d — the accord the customer gives itself, before anything reaches Nexgen.
 *
 * Somebody who may raise a request but not decide on one sends it; it stops inside their own
 * company and waits. Nothing is provisioned, nothing is billed, and our side is not shown it
 * as work. Then the person who does decide either agrees — and only then does it reach us —
 * or refuses it in as many words, and it never does.
 *
 * The run walks both endings, refusal first, because a refusal that quietly reaches us anyway
 * is the failure that matters here.
 */

test.describe.configure({ mode: 'serial' });

/** Raise a request for one person and one service, as far as the send button. */
const raise = async (page: Page, person: string) => {
  await land(page);
  await go(page, 'Requests');
  await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
  await page.waitForLoadState('networkidle');

  await addExisting(page, person);

  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });

  const row = page
    .locator('tbody tr')
    .filter({ hasText: PERSONAL_SERVICE })
    .filter({ hasText: /Add · \d+/ })
    .last();

  await row.getByRole('button', { name: /^Add · \d+$/ }).click();

  const impact = page.getByRole('dialog');

  await impact.getByRole('button', { name: 'Add action' }).click();
  await expect(impact).toHaveCount(0, { timeout: 20_000 });

  await submitRequest(page, 2);
};

const openLatest = async (page: Page) => {
  await land(page);
  await go(page, 'Requests');
  await openRow(page, /SR-/);
};

test.describe('Two people nobody has served yet', () => {
  test.use(as('admin'));

  test('they are put on file, holding nothing', async ({ page }) => {
    // their own people: everybody else in the journey already holds this service, and an act
    // that reaches nobody is never offered
    for (const person of [ACCORD_ONE, ACCORD_TWO]) {
      await createPerson(page, person, 'Finance');
      await expect(page.getByText(person).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});

test.describe('Somebody who asks but does not decide', () => {
  test.use(as('requester'));

  test('what they send waits for their own company, and says so', async ({ page }) => {
    await raise(page, ACCORD_ONE);
    await openLatest(page);

    await expect(page.getByText(/AWAITING CUSTOMER APPROVAL/i).first()).toBeVisible({
      timeout: 25_000,
    });

    // it is their company's decision, not theirs: no button is offered to them
    await expect(
      page.getByText(/Waiting for approval inside your company/),
      'they are told who it is waiting on'
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Approve and send to Nexgen/ }),
      'and they are not the one who decides'
    ).toHaveCount(0);
  });
});

test.describe('Nexgen is not shown it yet', () => {
  test.use(as('technician'));

  test('a request still waiting inside the company is not work for us', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');

    const queue = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(queue, 'nothing reaches our queue before the accord').not.toMatch(
      /AWAITING CUSTOMER APPROVAL/i
    );
  });
});

test.describe('The person who decides refuses one', () => {
  test.use(as('manager'));

  test('a refusal needs a reason, and stops the request there', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');

    // the listing says how many are waiting on them, and filters to exactly those
    const banner = page.getByText(/waiting for your accord/);

    await expect(banner, 'they are told what is waiting on them').toBeVisible({ timeout: 25_000 });
    await banner.click();
    await page.waitForLoadState('networkidle');

    await openRow(page, /SR-/);
    await refuseFromBar(page, 'ZZE2E journey: not this quarter, the budget is spent');
  });
});

test.describe('And it never reaches us', () => {
  test.use(as('technician'));

  test('a request refused inside the company is not in our queue', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');

    const queue = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(queue, 'what the company refused stops at the company').not.toContain(
      'the budget is spent'
    );
  });
});

test.describe('The one they agree to does reach us', () => {
  test('it is raised, approved, and lands in our queue', async ({ browser }) => {
    const asking = await browser.newContext(as('requester'));
    const askingPage = await asking.newPage();

    await raise(askingPage, ACCORD_TWO);
    await asking.close();

    const deciding = await browser.newContext(as('manager'));
    const decidingPage = await deciding.newPage();

    await openLatest(decidingPage);
    await approveFromBar(decidingPage);
    await deciding.close();

    const ours = await browser.newContext(as('technician'));
    const oursPage = await ours.newPage();

    await land(oursPage);
    await go(oursPage, 'Requests');

    // what the company agreed to is ours to carry out now
    await expect(
      oursPage.locator('tbody tr').filter({ hasText: ACCORD_TWO }).first(),
      'the approved request reaches our queue'
    ).toBeVisible({ timeout: 25_000 });

    await ours.close();
  });
});
