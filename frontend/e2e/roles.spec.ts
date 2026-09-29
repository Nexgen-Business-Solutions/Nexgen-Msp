import { expect, test } from '@playwright/test';
import { asAdministrator, asManager, asOperator, asTechnician, fixture, open } from './helpers';

/**
 * The same application, read by four different people.
 *
 * What each one may do is decided on the server; these journeys check that the screens agree
 * with it, and above all that they do not offer a door that would be refused behind it.
 */

test.describe('A customer manager', () => {
  test.use(asManager);

  test('may raise a request and read their own company only', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Entire company/ })).toBeEnabled();
  });

  test('reads their own portfolio and their own people', async ({ page }) => {
    await open(page, '/msp/services');
    await expect(page.getByPlaceholder('Search a service…')).toBeVisible();

    await open(page, '/msp/users');
    await expect(page.getByText('ZZE2E Alice').first()).toBeVisible();
  });
});

test.describe('A customer operator', () => {
  test.use(asOperator);

  test('is told plainly that raising a request is not theirs to do', async ({ page }) => {
    await open(page, '/msp/requests/new');

    await expect(page.getByText('You may not raise requests')).toBeVisible();
    await expect(page.getByRole('button', { name: /Select existing/ })).toHaveCount(0);
  });

  test('still reads the company file they are there to read', async ({ page }) => {
    await open(page, '/msp/services');

    await expect(page.getByText('ZZE2E Mailbox').first()).toBeVisible();
  });
});

test.describe('A technician', () => {
  test.use(asTechnician);

  test('works the queue and sees the fulfilment steps', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.add_request}`);

    await expect(page.getByRole('button', { name: 'Review lines' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeVisible();
  });

  test('has no billing screen of their own, and is not shown a dead one', async ({ page }) => {
    await open(page, '/msp/billing');

    // the guard takes them home rather than opening a screen they may not act on
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Billing', exact: true })).toHaveCount(0);
  });
});

test.describe('A system administrator', () => {
  test.use(asAdministrator);

  test('reads the same request and the money screens as well', async ({ page }) => {
    await open(page, `/msp/requests/${fixture.request}`);
    await expect(page.getByRole('heading', { name: fixture.request })).toBeVisible();

    await open(page, '/msp/billing');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
  });
});
