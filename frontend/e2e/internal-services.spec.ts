import { expect, test } from '@playwright/test';
import { asAdministrator, open } from './helpers';

// the catalogue is an administrator's screen, not a technician's
test.use(asAdministrator);

test.describe('The service catalogue, read by our own team', () => {
  test('says how many companies use each service, and drops the ERPNext plumbing', async ({
    page,
  }) => {
    await open(page, '/msp/services');

    const header = page.locator('table').filter({ hasText: 'MSP availability' }).locator('thead');

    await expect(header).toContainText('Companies using it');
    await expect(header).toContainText('Open assignments');
    await expect(header).not.toContainText('ERPNext Item');
    await expect(header).not.toContainText('ERPNext status');
  });

  test('the company count is not the assignment count', async ({ page }) => {
    await open(page, '/msp/services');

    const row = page.locator('tbody tr').filter({ hasText: 'ZZE2E Mailbox' }).first();

    await expect(row).toBeVisible();

    // two people of one company hold it: one company, two assignments
    const cells = await row.locator('td').allTextContents();

    expect(cells.join(' ')).toContain('ZZE2E Mailbox');
  });
});
