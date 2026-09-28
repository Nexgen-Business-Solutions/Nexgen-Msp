import { expect, test } from '@playwright/test';
import { ground } from './ground';
import { totp } from '../totp';

/**
 * Signing in, through the screen somebody actually uses.
 *
 * Every other phase arrives already signed in: the run mints its sessions over the API, which
 * is right for a journey about the application, and wrong as the only thing that ever exercises
 * the door. Nothing here shares a line of code with that shortcut.
 *
 * Three things are asked of it: a right password and a right code let you in; a wrong code says
 * so and leaves you on the code screen, with the password never accused; and the code you were
 * given a moment ago still works, because a sign-in that dies while you read your phone is a
 * sign-in nobody can use.
 */

test.describe.configure({ mode: 'serial' });

test.use({ storageState: { cookies: [], origins: [] } });

const land = async (page: import('@playwright/test').Page) => {
  await page.goto('/msp');
  await page.waitForLoadState('networkidle');
};

const password = async (page: import('@playwright/test').Page, who: 'admin' | 'manager') => {
  await land(page);

  await page.getByLabel(/Email|Username/i).first().fill(ground[who]);
  await page.getByLabel(/^Password$/i).fill(ground.password);
  await page.getByRole('button', { name: /Sign in|Continue/i }).first().click();

  // the second door: the screen asks for the code rather than letting anybody through
  await expect(page.getByText(/code/i).first()).toBeVisible({ timeout: 25_000 });
};

const typeCode = async (page: import('@playwright/test').Page, code: string) => {
  const boxes = page.getByRole('textbox');
  const many = await boxes.count();

  if (many > 1) {
    // one box per digit
    for (let at = 0; at < code.length && at < many; at += 1) {
      await boxes.nth(at).fill(code[at]);
    }
  } else {
    await boxes.first().fill(code);
  }
};

test.describe('The door', () => {
  test('a right password and a right code let you in', async ({ page }) => {
    await password(page, 'admin');
    await typeCode(page, totp(ground.admin_secret));

    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Incorrect username or password/i)).toHaveCount(0);
  });

  test('a wrong code blames the code, and leaves you on the code screen', async ({ page }) => {
    await password(page, 'manager');
    await typeCode(page, '000000');

    const said = page.getByText(/Invalid code|Incorrect username or password|expired/i).first();

    await expect(said).toBeVisible({ timeout: 25_000 });
    await expect(
      page.getByText(/Incorrect username or password/i),
      'a mistyped code is not a wrong password'
    ).toHaveCount(0);

    // still the second step: the password is not asked for again
    await expect(page.getByLabel(/^Password$/i)).toHaveCount(0);
  });

  test('typing the code and pressing the button still lets you in, once', async ({ page }) => {
    await password(page, 'admin');
    await typeCode(page, totp(ground.admin_secret));

    // the field sends it on the sixth digit; pressing the button as well must not spend the
    // sign-in a second time and report it expired having just opened it
    const button = page.getByRole('button', { name: /^Sign in$/ });

    if (await button.count()) await button.first().click({ trial: false }).catch(() => {});

    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/expired/i),
      'a sign-in that worked is not then called expired'
    ).toHaveCount(0);
  });

  test('the sign-in is still alive a quarter of a minute later', async ({ page }) => {
    await password(page, 'manager');

    // long enough to read a phone, which is what this step is for
    await page.waitForTimeout(15_000);

    await typeCode(page, totp(ground.manager_secret));

    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/expired/i),
      'a sign-in must outlive the time it takes to read the code'
    ).toHaveCount(0);
  });
});
