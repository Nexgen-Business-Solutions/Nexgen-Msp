import { expect, test } from '@playwright/test';
import { asManager, box, open } from './helpers';

test.use(asManager);

test.describe('The customer reads its own portfolio', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, '/msp/services');
  });

  test('the filter sits on the right of the search, on the same line', async ({ page }) => {
    const search = page.getByPlaceholder('Search a service…');
    const filter = page.getByRole('button', { name: 'All services' });

    const searchBox = await box(search);
    const filterBox = await box(filter);

    expect(filterBox.x, 'the filter follows the search').toBeGreaterThan(
      searchBox.x + searchBox.width - 1
    );
    expect(
      Math.abs(filterBox.y + filterBox.height / 2 - (searchBox.y + searchBox.height / 2)),
      'both sit on one line'
    ).toBeLessThan(8);
  });

  test('a service that ended stays in the portfolio', async ({ page }) => {
    const rows = page.locator('tbody tr');

    await expect(rows.filter({ hasText: 'ZZE2E VPN access' })).toHaveCount(1);

    await page.getByRole('button', { name: 'All services' }).click();
    await page.getByRole('option', { name: /^Ended/ }).click();

    await expect(rows.filter({ hasText: 'ZZE2E VPN access' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Ended' }).click();
    await page.getByRole('option', { name: /^In use/ }).click();

    await expect(rows.filter({ hasText: 'ZZE2E Mailbox' })).toHaveCount(1);
  });
});
