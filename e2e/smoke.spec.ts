import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for what's reachable without real credentials, plus one
 * real sign-in test: unlike the old Google-only flow, the email path in
 * the Circle DCW popup needs no external provider, so it's genuinely
 * testable here — this test creates a real Circle sandbox wallet each run
 * when CIRCLE_API_KEY/CIRCLE_ENTITY_SECRET are configured (a fresh email
 * per run avoids colliding with previous runs). Enode Link -> mint -> globe
 * pins still need a real Enode OEM login and are exercised manually — see
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

test('email sign-in creates a session and the wallet chip opens Devices/Add vehicle/Log out', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'Connect Wallet' }),
  ).toBeVisible();

  const email = `e2e-${Date.now()}@example.com`;
  await page.getByPlaceholder('Email address').fill(email);
  await page.getByRole('button', { name: 'Create Wallet' }).click();

  // The modal closes and the header trigger becomes the wallet chip
  // (a 0x-prefixed, shortened address) once the session is established.
  await expect(
    page.getByRole('heading', { name: 'Connect Wallet' }),
  ).not.toBeVisible({
    timeout: 15_000,
  });
  const walletTrigger = page.getByRole('button', { name: /^0x/ });
  await expect(walletTrigger).toBeVisible();

  // Devices now only exists behind the wallet dropdown.
  await walletTrigger.click();
  await page.getByRole('link', { name: 'Devices' }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByText('Sign in to continue')).not.toBeVisible();

  // Add vehicle is a popup, not a page — it stays on /devices and opens
  // the DeviceOnboardModal instead of navigating away.
  await walletTrigger.click();
  await page.getByRole('button', { name: 'Add vehicle' }).click();
  await expect(
    page.getByRole('heading', { name: 'Add vehicle' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/devices$/);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(
    page.getByRole('heading', { name: 'Add vehicle' }),
  ).not.toBeVisible();

  await walletTrigger.click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
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
