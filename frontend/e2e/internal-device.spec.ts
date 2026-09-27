import { expect, test } from '@playwright/test';
import { asTechnician, box, fixture, open } from './helpers';

test.use(asTechnician);

test.describe("A machine's page, read in a browser", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, `/msp/devices/${fixture.device}`);
  });

  test('the services filter sits on the right, beside the action', async ({ page }) => {
    const panel = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Services', exact: true }) })
      .last();
    const filter = page.getByRole('button', { name: 'All services' });
    const action = page.getByRole('button', { name: 'Add service' });

    const panelBox = await box(panel);
    const filterBox = await box(filter);
    const actionBox = await box(action);

    expect(filterBox.x).toBeGreaterThan(panelBox.x + panelBox.width / 2);
    expect(Math.abs(filterBox.y - actionBox.y)).toBeLessThan(12);
    expect(filterBox.x).toBeLessThan(actionBox.x);
  });

  test('the machine reads its own service and says who holds it', async ({ page }) => {
    await expect(page.getByText('ZZE2E Antivirus').first()).toBeVisible();
    await expect(page.getByText('ZZE2E Alice').first()).toBeVisible();
  });
});
