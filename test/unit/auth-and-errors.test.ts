import { describe, expect, it } from 'vitest';

import { getHealth } from '@/server/application/health/get-health';
import {
  apiKeysEqual,
  generateApiKeyMaterial,
  hashApiKey,
} from '@/server/infrastructure/auth/api-keys';
import {
  ApiError,
  mapUnknownErrorToApiError,
} from '@/server/transport/http/api-error';

describe('api key hashing', () => {
  it('generates a prefixed high-entropy key', () => {
    const material = generateApiKeyMaterial();
    expect(material.secret.startsWith('evt_')).toBe(true);
    expect(material.keyPrefix).toBe(material.secret.slice(0, 12));
  });

  it('hashes deterministically and compares in constant time', () => {
    const secret = 'evt_test_secret_value_abcdefghijklmnopqrstuvwxyz';
    const hashSecret = 'test-api-key-hash-secret-32chars!!';
    const a = hashApiKey(secret, hashSecret);
    const b = hashApiKey(secret, hashSecret);
    expect(apiKeysEqual(a, b)).toBe(true);
    expect(apiKeysEqual(a, hashApiKey('other', hashSecret))).toBe(false);
  });
});

describe('api error mapping', () => {
  it('preserves ApiError instances', () => {
    const error = new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'bad',
      status: 400,
    });
    expect(mapUnknownErrorToApiError(error)).toBe(error);
  });

  it('maps unknown errors to INTERNAL_ERROR without exposing details', () => {
    const mapped = mapUnknownErrorToApiError(new Error('secret sql dump'));
    expect(mapped.code).toBe('INTERNAL_ERROR');
    expect(mapped.expose).toBe(false);
    expect(mapped.message).not.toContain('sql');
  });
});

describe('getHealth', () => {
  it('returns an ok liveness payload', () => {
    const health = getHealth();
    expect(health.status).toBe('ok');
    expect(health.service).toBe('ev-telemetry-backend');
    expect(Date.parse(health.checkedAt)).not.toBeNaN();
  });
});
