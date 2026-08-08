import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('home page redirects to the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('dashboard renders empty or live data state', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeVisible();

    // Dashboard is session-scoped. Unauthenticated CI has no cookie →
    // "Connect your wallet". With DB issues → "No data". With a session but
    // no bindings → "No wallets yet". Signed-in with devices → live section.
    await expect(
      page
        .getByText('Connect your wallet')
        .or(page.getByText('No data'))
        .or(page.getByText('No wallets yet'))
        .or(page.getByText('Devices — request & unlock')),
    ).toBeVisible();
  });

  test('primary navigation reaches devices', async ({ page }) => {
    await page.goto('/dashboard');
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Devices' })
      .click();
    await expect(page).toHaveURL(/\/devices$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Devices' }),
    ).toBeVisible();
  });
});
