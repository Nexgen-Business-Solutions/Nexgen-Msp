import { expect, test } from '@playwright/test';
import { asManager, asTechnician, fixture, open } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('The customer reads the acts they asked for', () => {
  test.use(asManager);

  test('the request is presented as action groups, with the counts it was raised with', async ({
    page,
  }) => {
    await open(page, `/msp/requests/${fixture.request}`);

    await expect(page.getByText('End ZZE2E Helpdesk')).toBeVisible();
    await expect(page.getByText(/2 targets from 4 selected people/)).toBeVisible();
    await expect(
      page.getByText(/2 will be affected · 2 were left unchanged at request time/)
    ).toBeVisible();
  });

  test('the people an act did not reach are named, with the reason', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.request}`);

    await page.getByRole('button', { name: 'View unchanged' }).click();

    await expect(page.getByRole('heading', { name: 'Unchanged at request time' })).toBeVisible();
    await expect(page.getByText('NO_CURRENT_ASSIGNMENT').first()).toBeVisible();
  });
});

test.describe('Nexgen carries the work out', () => {
  test.use(asTechnician);

  test('the review offers one decision for the whole act', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.request}`);

    await expect(page.getByText('End ZZE2E Helpdesk').first()).toBeVisible();
    await page.getByRole('button', { name: /Accept all 2/ }).first().click();

    await expect(page.getByText(/2 accepted/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the act runs as one button and each target is carried out on its own', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.request}`);

    // the lines were decided in the previous test; this is the step that turns them into work
    const start = page.getByRole('button', { name: 'Continue to Execute' });

    if (await start.isVisible().catch(() => false)) {
      await start.click();
    }

    // the page opens on whatever stage the server says; say plainly which one is being read
    await page.getByRole('button', { name: 'Execute', exact: true }).click();

    await expect(page.getByRole('button', { name: /Execute 2 ready/ })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: /Execute 2 ready/ }).click();

    await expect(page.getByText(/2 completed|Completed/).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('The information a customer was never asked for', () => {
  test.use(asTechnician);

  test('what is owed is named, entered in one dialog, and kept when the page is left', async ({
    page,
  }) => {
    await open(page, `/msp/requests/${fixture.add_request}`);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();

    // the work is ready in every other respect: it waits on two usernames
    await expect(page.getByRole('button', { name: 'Complete 2 usernames' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Complete 2 usernames' }).click();

    await expect(page.getByText('0 of 2 completed')).toBeVisible();

    const first = page.getByRole('textbox', { name: /^Username for/ }).first();

    await first.fill('e2e.first');
    await page.getByRole('button', { name: 'Save progress' }).click();

    // one saved, one still owed — and the request remembers which
    await expect(page.getByRole('button', { name: 'Complete 1 usernames' })).toBeVisible({
      timeout: 20_000,
    });

    await page.reload();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Complete 1 usernames' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('a username already taken is refused on its own row, in plain words', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.add_request}`);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await page.getByRole('button', { name: /Complete 1 usernames/ }).click();

    await page.getByRole('textbox', { name: /^Username for/ }).first().fill('e2e.first');
    await page.getByRole('button', { name: /Save/ }).click();

    await expect(page.getByText(/is already used by another Client User/)).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('What a request has to prepare before its real work can run', () => {
  test.use(asTechnician);

  test('a person who does not exist yet is created from the dialog', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.new_person_request}`);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Create 1 Client Users' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Create 1 Client Users' }).click();

    await expect(page.getByRole('heading', { name: 'Create requested Client Users' })).toBeVisible();
    await page.getByRole('button', { name: /ZZE2E Recruit/ }).first().click();

    // the customer was never asked for a Department; the person still ends up with one
    await expect(page.getByRole('button', { name: 'Create this person' })).toBeDisabled();

    await page.getByRole('button', { name: 'Choose a Department' }).click();
    await page.getByRole('option', { name: /ZZE2E Finance/ }).click();

    await page.getByRole('textbox', { name: /^Username for/ }).fill('e2e.recruit');
    await page.getByRole('textbox', { name: /^Email for/ }).fill('recruit@zze2e.invalid');
    await page.getByRole('button', { name: 'Create this person' }).click();

    await expect(page.getByText('1 of 1 completed')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();

    // the person now exists, so the dialog is no longer offered
    await expect(page.getByRole('button', { name: 'Create 1 Client Users' })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test('a machine nobody settled is registered from the dialog', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.new_person_request}`);
    await page.getByRole('button', { name: 'Execute', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Prepare 1 Devices' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Prepare 1 Devices' }).click();

    await expect(page.getByRole('heading', { name: 'Prepare required Devices' })).toBeVisible();
    await page.getByRole('button', { name: /ZZE2E Recruit/ }).first().click();
    await page.getByRole('button', { name: 'Register new Device' }).click();

    await page.getByRole('textbox', { name: /^Hostname for/ }).fill('ZZE2E-RECRUIT-PC');
    await page.getByRole('textbox', { name: /^Serial number for/ }).fill('ZZE2E-SN-RECRUIT');
    await page.getByRole('button', { name: 'Save this Device' }).click();

    await expect(page.getByText('1 of 1 completed')).toBeVisible({ timeout: 30_000 });
  });
});
