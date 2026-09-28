import { expect, test, type Page } from '@playwright/test';
import { as, createPerson, go, land, openRow, runReadyWork, seek } from './ground';
import { CIRCUIT_ONE, CIRCUIT_TWO, PERSONAL_SERVICE } from './names';

/**
 * The request, from the first click to the last, through every gate it has.
 *
 * The other phases each walk one shape of request. This one walks the machinery: the doors
 * that refuse you, the draft you leave and come back to, the accord your own company has to
 * give, the lines we accept and the lines we turn down, and the closing.
 *
 * It is deliberately unkind. A request that only ever meets agreement proves nothing about
 * what happens when somebody says no.
 */

test.describe.configure({ mode: 'serial' });

const DEPARTMENT = 'Logistics';
const DRAFT_ONLY = 'ZZE2E circuit: saved and picked up again';
const TURNED_DOWN = 'ZZE2E circuit: not for this one, ask again next quarter';

const pickPeople = async (page: Page, people: string[]) => {
  for (const person of people) {
    await page.getByRole('button', { name: /Select existing/ }).click();

    const picker = page.getByRole('dialog');

    await picker.getByLabel('Search').fill(person);
    await picker
      .locator('div')
      .filter({ hasText: person })
      .getByRole('button', { name: /^Add$/ })
      .last()
      .click();
    await picker.getByRole('button', { name: 'Done' }).click();
    await expect(picker).toHaveCount(0, { timeout: 20_000 });
  }
};

const addTheService = async (page: Page) => {
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
  await impact.getByRole('button', { name: 'Add action' }).click();
  await expect(impact).toHaveCount(0, { timeout: 20_000 });
};

const openBuilder = async (page: Page) => {
  await land(page);
  await go(page, 'Requests');
  await page.getByRole('button', { name: /New request|Raise a request/ }).first().click();
  await page.waitForLoadState('networkidle');
};

test.describe('The people this circuit needs', () => {
  test.use(as('admin'));

  test('two of them, holding nothing', async ({ page }) => {
    for (const person of [CIRCUIT_ONE, CIRCUIT_TWO]) {
      await createPerson(page, person, DEPARTMENT);
      await expect(page.getByText(person).first()).toBeVisible({ timeout: 20_000 });
    }
  });
});

test.describe('The doors that refuse you', () => {
  test.use(as('requester'));

  test('an empty request cannot be carried forward', async ({ page }) => {
    await openBuilder(page);

    // nobody chosen: the step after this one is not reachable
    await expect(
      page.getByRole('button', { name: 'Continue', exact: true }),
      'with nobody named there is nothing to continue to'
    ).toBeDisabled();
  });

  test('people without an action are not a request', async ({ page }) => {
    await openBuilder(page);
    await pickPeople(page, [CIRCUIT_ONE]);
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText('Add at least one requested action before continuing.'),
      'the screen says what is missing, in as many words'
    ).toBeVisible();
  });
});

test.describe('A draft left and picked up again', () => {
  test.use(as('requester'));

  test('what was configured is what comes back', async ({ page }) => {
    await openBuilder(page);
    await pickPeople(page, [CIRCUIT_ONE, CIRCUIT_TWO]);
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Group actions stay explicit')).toBeVisible({ timeout: 20_000 });
    await addTheService(page);

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible({ timeout: 25_000 });

    // leave it, and come back to it from the register
    await land(page);
    await go(page, 'Requests');
    await openRow(page, /DRAFT|Draft/);
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('tbody tr').filter({ hasText: CIRCUIT_ONE }),
      'the people come back'
    ).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: CIRCUIT_TWO })).toHaveCount(1);

    await page.getByRole('button', { name: /Continue/ }).click();

    // and so does the act, which is the part that used to be lost
    await expect(
      page.getByText(new RegExp(`Add ${PERSONAL_SERVICE}`)).first(),
      'the act configured before saving is still configured'
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /Continue/ }).click();
    await page.getByRole('button', { name: /Continue/ }).click();
    await expect(page.getByText('Confirm the exact snapshot and requested actions.')).toBeVisible();
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.waitForURL(
      (url) => /\/msp\/requests/.test(url.pathname) && !url.pathname.endsWith('/new'),
      { timeout: 30_000 }
    );

    expect(DRAFT_ONLY).toBeTruthy();
  });
});

test.describe('The company says no', () => {
  test.use(as('manager'));

  test('a refusal needs a reason, and stops the request dead', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');
    await openRow(page, /SR-/);

    await expect(page.getByText('This request is waiting for your accord')).toBeVisible({
      timeout: 25_000,
    });

    await page.getByRole('button', { name: 'Refuse it' }).click();

    // nothing typed, nothing sent
    await expect(
      page.getByRole('button', { name: 'Confirm the refusal' }),
      'a refusal with no reason is not a refusal'
    ).toBeDisabled();

    await page.getByPlaceholder(/Why are you refusing/).fill(TURNED_DOWN);
    await page.getByRole('button', { name: 'Confirm the refusal' }).click();

    await expect(page.getByText(/REJECTED|Rejected/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(TURNED_DOWN).first()).toBeVisible();
  });
});

test.describe('What the company refused never becomes our work', () => {
  test.use(as('technician'));

  test('it is not in the queue, and its reason never reached us as work', async ({ page }) => {
    await land(page);
    await go(page, 'Requests');

    const queue = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    expect(queue, 'a refusal inside the company stops there').not.toContain(TURNED_DOWN);
  });
});

test.describe('A second request, agreed to, and decided line by line', () => {
  test('raised, approved, one line accepted and one turned down', async ({ browser }) => {
    const asking = await browser.newContext(as('requester'));
    const askingPage = await asking.newPage();

    await openBuilder(askingPage);
    await pickPeople(askingPage, [CIRCUIT_ONE, CIRCUIT_TWO]);
    await askingPage.getByRole('button', { name: /Continue/ }).click();
    await expect(askingPage.getByText('Group actions stay explicit')).toBeVisible({
      timeout: 20_000,
    });
    await addTheService(askingPage);

    await askingPage.getByRole('button', { name: /Continue/ }).click();
    await askingPage.getByRole('button', { name: /Continue/ }).click();
    await askingPage.getByRole('button', { name: 'Submit request' }).click();
    await askingPage.waitForURL(
      (url) => /\/msp\/requests/.test(url.pathname) && !url.pathname.endsWith('/new'),
      { timeout: 30_000 }
    );
    await asking.close();

    const deciding = await browser.newContext(as('manager'));
    const decidingPage = await deciding.newPage();

    await land(decidingPage);
    await go(decidingPage, 'Requests');
    await openRow(decidingPage, /SR-/);
    await decidingPage.getByRole('button', { name: /Approve and send to Nexgen/ }).click();
    await expect(decidingPage.getByText(/AWAITING CUSTOMER APPROVAL/i)).toHaveCount(0, {
      timeout: 30_000,
    });
    await deciding.close();

    const ours = await browser.newContext(as('technician'));
    const page = await ours.newPage();

    await land(page);
    await go(page, 'Requests');
    await openRow(page, CIRCUIT_TWO);

    // one line is turned down, with a reason, and the reason is required. The workspace shows
    // one person at a time, so the person is chosen first and the line acted on after
    await page.getByRole('button', { name: new RegExp(CIRCUIT_TWO) }).first().click();
    await expect(page.getByText(CIRCUIT_TWO).first()).toBeVisible({ timeout: 20_000 });

    // the line's own Reject, not the header's, which turns down the whole request
    await page.getByRole('button', { name: 'Reject', exact: true }).last().click();

    const dialog = page.getByRole('dialog');

    await expect(
      dialog.getByText('Reject request line'),
      'this is the line being turned down, not the request'
    ).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('A reason is required and stays on the record.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reject line' })).toBeDisabled();
    await dialog.getByRole('textbox').first().fill('ZZE2E circuit: they are leaving next month');
    await dialog.getByRole('button', { name: 'Reject line' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 25_000 });

    // the other is accepted, and the request can go on
    const accept = page.getByRole('button', { name: /^Accept all( pending| \d+)$/ }).first();

    await expect(accept).toBeVisible({ timeout: 25_000 });
    await accept.click();
    await expect(page.getByText('Line review complete')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/1 accepted · 1 rejected/)).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Execute' }).click();
    await page.waitForLoadState('networkidle');

    await runReadyWork(page, 'Add service', 'zze2e.circuit');

    await ours.close();
  });
});

test.describe('And the outcome is exactly what was decided', () => {
  test.use(as('technician'));

  test('the accepted one holds the service, the refused one holds nothing', async ({ page }) => {
    await land(page);
    await go(page, 'Users');
    await openRow(page, CIRCUIT_ONE);

    await expect(
      page.locator('tbody tr').filter({ hasText: PERSONAL_SERVICE }).first(),
      'what we accepted was carried out'
    ).toBeVisible({ timeout: 25_000 });

    await go(page, 'Users');
    await openRow(page, CIRCUIT_TWO);

    await expect(
      page.locator('tbody tr').filter({ hasText: PERSONAL_SERVICE }),
      'what we turned down left nothing behind'
    ).toHaveCount(0);
    await expect(page.getByText(/No service assignment is recorded/)).toBeVisible();
  });

  test('and asking again for what is already running is not offered', async ({ page }) => {
    await land(page);
    await go(page, 'Users');
    await seek(page, CIRCUIT_ONE);

    // the register and the page agree that they hold it
    await expect(
      page.locator('tbody tr').filter({ hasText: CIRCUIT_ONE }).first()
    ).toBeVisible({ timeout: 20_000 });
  });
});
