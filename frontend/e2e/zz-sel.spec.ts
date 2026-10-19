import { expect, test } from '@playwright/test';
import { asAdministrator, open } from './helpers';

test.use({ ...asAdministrator, viewport: { width: 1500, height: 1000 } });

test('a proposal opens straight on the selection, concerned only', async ({ page }) => {
  await open(page, '/msp/billing/new?contract=CON-2026-0364&start=2026-07-13&end=2026-12-31');
  await expect(page.getByText('Who gets billed')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/selection.png` });

  const boxes = page.getByRole('checkbox');
  const total = await boxes.count();
  let ticked = 0;
  for (let i = 0; i < total; i += 1) if (await boxes.nth(i).isChecked()) ticked += 1;
  console.log(`CASES ${total} COCHEES ${ticked}`);
});
