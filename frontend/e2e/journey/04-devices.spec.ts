import { expect, test } from '@playwright/test';
import { as, go, ground, land, openRow, seek } from './ground';
import { DIRECT, LAPTOP, SPARE } from './names';

/** Phase 3 of the plan — the machines, and who holds them. */

test.use(as('admin'));

const register = async (
  page: import('@playwright/test').Page,
  hostname: string,
  serial: string,
  holder?: string
) => {
  await land(page);
  await go(page, 'Devices');
  await page.getByRole('button', { name: 'New device' }).click();

  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Select a customer' }).click();
  await page.getByRole('option', { name: new RegExp(ground.customer) }).first().click();

  if (holder) {
    await dialog.getByRole('button', { name: /Nobody/ }).click();
    await page.getByRole('option', { name: new RegExp(holder) }).first().click();
  }

  await dialog.getByPlaceholder('SN-HYS-JDUPONT').fill(hostname);
  await dialog.getByLabel('Serial number').fill(serial);
  await dialog.getByRole('button', { name: /^Add device$/ }).click();

  await expect
    .poll(
      async () =>
        (await dialog.count()) ? (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 250) : 'closed',
      { timeout: 25_000 }
    )
    .toBe('closed');
};

test.describe.serial('Machines', () => {
  test('one is registered and handed to somebody', async ({ page }) => {
    await register(page, LAPTOP, 'ZZE2E-SN-LT1', DIRECT);

    await go(page, 'Devices');
    await seek(page, LAPTOP);
  });

  test('a second stays in stock, held by nobody', async ({ page }) => {
    await register(page, SPARE, 'ZZE2E-SN-LT2');

    await go(page, 'Devices');
    await seek(page, SPARE);
  });

  test('the same serial cannot name two machines', async ({ page }) => {
    await land(page);
    await go(page, 'Devices');
    await page.getByRole('button', { name: 'New device' }).click();

    const dialog = page.getByRole('dialog');

    await dialog.getByRole('button', { name: 'Select a customer' }).click();
    await page.getByRole('option', { name: new RegExp(ground.customer) }).first().click();
    await dialog.getByPlaceholder('SN-HYS-JDUPONT').fill('ZZE2E-JOURNEY-LT3');
    await dialog.getByLabel('Serial number').fill('ZZE2E-SN-LT1');

    // refused at the field it is typed in, and the machine already holding it is named,
    // rather than letting the form be sent and answering with a server error
    await expect(dialog.getByText(/already on/i).first()).toBeVisible({ timeout: 25_000 });
    await expect(dialog.getByText(LAPTOP).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Add device$/ })).toBeDisabled();
  });

  test('the machine and the person agree about who holds it', async ({ page }) => {
    await land(page);
    await go(page, 'Devices');
    await openRow(page, LAPTOP);

    await expect(page.getByText(DIRECT).first()).toBeVisible({ timeout: 20_000 });

    await go(page, 'Users');
    await openRow(page, DIRECT);

    await expect(page.getByText(LAPTOP).first()).toBeVisible({ timeout: 20_000 });
  });
});
