import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for what's reachable without completing Google sign-in.
 * Enode Link -> mint -> globe pins still need a real Enode OEM login and
 * are exercised manually — see docs/demo-runbook.md.
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
});

test('starting an Enode link session while unauthenticated is rejected server-side', async ({
  request,
}) => {
  // "Add vehicle" is a popup reachable only from the signed-in wallet
  // dropdown (see DeviceOnboardModal) — there is no page route to visit
  // while signed out, so the auth boundary is exercised at the API directly.
  const response = await request.post('/api/v1/vehicle-onboarding/link', {
    data: {},
  });
  expect(response.status()).toBe(401);
});

test('sign-in popup has no email field', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect Wallet' }),
  ).toBeVisible();
  await expect(page.getByPlaceholder('Email address')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Wallet' })).toHaveCount(
    0,
  );
});

test('session endpoint rejects a typed email', async ({ request }) => {
  const response = await request.post('/api/v1/dashboard/session', {
    data: { email: 'someone@example.com' },
  });
  expect(response.status()).toBe(400);
});

test('session endpoint rejects a forged Google token', async ({ request }) => {
  const response = await request.post('/api/v1/dashboard/session', {
    data: { idToken: 'not-a-google-id-token' },
  });
  expect(response.status()).toBe(401);
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
