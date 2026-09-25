import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for what's reachable without real Circle/Google/Enode
 * credentials: page structure, nav, and the auth gate on every protected
 * surface. The signed-in path (Google login -> Enode Link -> mint -> globe
 * pins) needs real provider credentials and is exercised manually — see
 * docs/demo-runbook.md.
 */

test('home page is the globe and never gates on sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Arc EV Fleet' })).toBeVisible();
  // The globe itself is the permanent base view — signed in or not, this
  // page must never show the "sign in to continue" wall other pages use.
  await expect(page.getByText('Sign in to continue')).not.toBeVisible();
});

test('devices page requires sign-in when unauthenticated', async ({ page }) => {
  await page.goto('/devices');
  await expect(page.getByText('Sign in to continue')).toBeVisible();
});

test('nav moves between home (globe) and devices', async ({ page }) => {
  await page.goto('/devices');
  await page.getByRole('link', { name: 'Arc EV Fleet' }).click();
  await expect(page).toHaveURL(/\/$/);
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
