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

test('email sign-in creates a session and shows the wallet chip', async ({
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
  await expect(page.getByRole('button', { name: /^0x/ })).toBeVisible();

  await page.goto('/devices');
  await expect(page.getByText('Sign in to continue')).not.toBeVisible();
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
