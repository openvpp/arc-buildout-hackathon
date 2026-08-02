import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('home page links through to the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('link', { name: 'Open dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('dashboard shows the placeholder notice and empty telemetry state', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/Placeholder:/)).toBeVisible();
    await expect(page.getByText('No telemetry to display')).toBeVisible();
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
