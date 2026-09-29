import { describe, expect, it } from 'vitest';

import { applicationErrorStatus } from '@/server/application/application-error';
import {
  decodeLocationCursor,
  encodeLocationCursor,
} from '@/server/application/dashboard/list-device-locations';
import { isSecureSessionCookie } from '@/server/infrastructure/auth/dashboard-session';
import { isAllowedEnodeLinkUrl } from '@/server/infrastructure/enode/link-url';
import { mapEnodeWebhookEvent } from '@/server/infrastructure/enode/webhook-mapper';
import { decideOutboxFollowUp } from '@/server/infrastructure/jobs/outbox-follow-up';
import {
  consumeRateLimit,
  resetRateLimitsForTests,
} from '@/server/transport/http/rate-limit';
import { escapeHtml, mapPopupRow } from '@/features/globe/map-popup';

describe('decideOutboxFollowUp', () => {
  it('completes a successful mint and retries a busy claim without burning attempts', () => {
    expect(
      decideOutboxFollowUp({
        outcome: 'minted',
        attempts: 1,
        maxAttempts: 5,
        hasInFlightTransaction: false,
        errorMessage: null,
      }),
    ).toEqual({ action: 'complete' });
    expect(
      decideOutboxFollowUp({
        outcome: 'busy',
        attempts: 2,
        maxAttempts: 5,
        hasInFlightTransaction: false,
        errorMessage: null,
      }),
    ).toMatchObject({ action: 'reschedule', attempts: 2 });
  });

  it('keeps retrying an in-flight transaction past the attempt cap', () => {
    const followUp = decideOutboxFollowUp({
      outcome: 'error',
      attempts: 5,
      maxAttempts: 5,
      hasInFlightTransaction: true,
      errorMessage: 'receipt timeout',
    });
    expect(followUp.action).toBe('reschedule');
  });

  it('fails the device only when nothing was broadcast and attempts are exhausted', () => {
    expect(
      decideOutboxFollowUp({
        outcome: 'error',
        attempts: 4,
        maxAttempts: 5,
        hasInFlightTransaction: false,
        errorMessage: 'rpc down',
      }),
    ).toMatchObject({
      action: 'fail',
      attempts: 5,
      markDeviceFailed: true,
    });
  });
});

describe('isAllowedEnodeLinkUrl', () => {
  it('allows Enode link hosts and rejects open redirects', () => {
    expect(isAllowedEnodeLinkUrl('https://link.enode.com/start')).toBe(true);
    expect(
      isAllowedEnodeLinkUrl('https://link.sandbox.enode.io/?linkToken=abc'),
    ).toBe(true);
    expect(isAllowedEnodeLinkUrl('https://evil.example/link.enode.com')).toBe(
      false,
    );
    expect(isAllowedEnodeLinkUrl('http://link.enode.com/')).toBe(false);
    expect(isAllowedEnodeLinkUrl('https://user:pass@link.enode.com/')).toBe(
      false,
    );
    expect(isAllowedEnodeLinkUrl('not a url')).toBe(false);
  });
});

describe('consumeRateLimit', () => {
  it('blocks once the window is full and reports when to retry', () => {
    resetRateLimitsForTests();
    const input = {
      key: 'test-bucket',
      limit: 2,
      windowMs: 10_000,
      now: 1_000,
    };
    expect(consumeRateLimit(input).ok).toBe(true);
    expect(consumeRateLimit({ ...input, now: 1_100 }).ok).toBe(true);
    const blocked = consumeRateLimit({ ...input, now: 1_200 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});

describe('mapEnodeWebhookEvent coordinates', () => {
  it('drops out-of-range coordinates and keeps a parseable event time', () => {
    const mapped = mapEnodeWebhookEvent({
      event: 'user:vehicle:updated',
      createdAt: '2026-09-30T12:00:00.000Z',
      vehicle: { id: 'veh', location: { latitude: 95, longitude: 10 } },
    });
    expect(mapped?.latitude).toBeNull();
    expect(mapped?.longitude).toBeNull();
    expect(mapped?.occurredAt?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
  });
});

describe('session cookie security', () => {
  it('is secure in production even if APP_ENV was left as development', () => {
    expect(
      isSecureSessionCookie({ appEnv: 'development', nodeEnv: 'production' }),
    ).toBe(true);
    expect(
      isSecureSessionCookie({ appEnv: 'development', nodeEnv: 'development' }),
    ).toBe(false);
  });
});

describe('application errors', () => {
  it('maps ownership failures to 403 or 404 and unknown codes to 400', () => {
    expect(applicationErrorStatus('PRINCIPAL_DISABLED')).toBe(403);
    expect(applicationErrorStatus('PENDING_CONNECTION_NOT_FOUND')).toBe(404);
    expect(applicationErrorStatus('SOMETHING_NEW')).toBe(400);
  });
});

describe('location cursors', () => {
  it('round-trips a timestamp and device id', () => {
    const at = new Date('2026-09-30T12:00:00.000Z');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(decodeLocationCursor(encodeLocationCursor(at, id))).toEqual({
      at,
      id,
    });
    expect(decodeLocationCursor('not-a-cursor')).toBeNull();
  });
});

describe('map popup html', () => {
  it('escapes nickname text instead of injecting markup', () => {
    const html = mapPopupRow('Name', '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(escapeHtml(`a&b"'<>`)).toBe('a&amp;b&quot;&#39;&lt;&gt;');
  });
});
