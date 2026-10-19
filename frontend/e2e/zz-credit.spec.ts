import { expect, test } from '@playwright/test';
import { asAdministrator, open } from './helpers';

test.use({ ...asAdministrator, viewport: { width: 1500, height: 1000 } });
test.setTimeout(120_000);

test('create credit note, from a customer with no run', async ({ page }) => {
  const dir = process.env.SHOT_DIR!;
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 200));
  });

  await open(page, '/msp/billing');
  await expect(page.getByRole('heading', { name: 'Ready to bill' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'SICG' }).filter({ hasText: 'Credit note' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Create credit note' }).click();

  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  console.log('URL', page.url());
  await page.screenshot({ path: `${dir}/credit-open.png` });
});
