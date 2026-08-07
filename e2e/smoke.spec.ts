import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('home page redirects to the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('dashboard renders empty or live data state', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();

    // Dashboard is wired to Postgres. Without bound wallets / DB (typical CI),
    // it shows "No data"; with wallets it shows locked device cards.
    await expect(
      page
        .getByText('No data')
        .or(page.getByText('No wallets yet'))
        .or(page.getByText('Devices — request & unlock')),
    ).toBeVisible();
  });

  test('primary navigation reaches wallets and devices', async ({ page }) => {
    await page.goto('/dashboard');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Wallets' })
      .click();
    await expect(page).toHaveURL(/\/wallets$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Wallets' }),
    ).toBeVisible();
  });
});
