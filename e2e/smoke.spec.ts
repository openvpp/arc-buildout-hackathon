import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for what's reachable without real Circle/Google/Enode
 * credentials: page structure, nav, and the auth gate on every protected
 * surface. The signed-in path (Google login -> Enode Link -> mint -> globe
 * pins) needs real provider credentials and is exercised manually — see
 * docs/demo-runbook.md.
 */

test('home page loads and links to the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Arc EV Fleet' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/devices$/);
});

test('devices page requires sign-in when unauthenticated', async ({ page }) => {
  await page.goto('/devices');
  await expect(page.getByText('Sign in to continue')).toBeVisible();
});

test('globe page requires sign-in when unauthenticated', async ({ page }) => {
  await page.goto('/globe');
  await expect(page.getByText('Sign in to continue')).toBeVisible();
});

test('nav links move between devices and globe', async ({ page }) => {
  await page.goto('/devices');
  await page.getByRole('link', { name: 'Globe' }).click();
  await expect(page).toHaveURL(/\/globe$/);
  await page.getByRole('link', { name: 'Devices' }).click();
  await expect(page).toHaveURL(/\/devices$/);
});

test('starting onboarding while unauthenticated surfaces a clear error, not a crash', async ({
  page,
}) => {
  await page.goto('/devices/onboard');
  await page.getByRole('button', { name: 'Connect with Enode' }).click();
  await expect(page.getByText('Sign in required.')).toBeVisible();
});

test('unsigned Enode webhook deliveries are rejected', async ({ request }) => {
  const response = await request.post('/api/webhooks/enode', {
    data: { event: 'user:vehicle:updated' },
  });
  expect(response.status()).toBe(401);
});

test('health check responds', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
});
