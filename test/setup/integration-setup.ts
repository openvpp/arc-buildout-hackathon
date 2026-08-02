/**
 * Integration test setup.
 * Requires PostgreSQL (docker compose service `postgres_test` on :5433).
 */
import { beforeAll } from 'vitest';

function setEnv(key: string, value: string): void {
  // ProcessEnv keys are typed readonly for app safety; tests may override.
  (process.env as Record<string, string | undefined>)[key] = value;
}

beforeAll(() => {
  if (process.env.DATABASE_URL === undefined) {
    setEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test',
    );
  }
  if (process.env.API_KEY_HASH_SECRET === undefined) {
    setEnv('API_KEY_HASH_SECRET', 'test-api-key-hash-secret-32chars!!');
  }
  setEnv('APP_ENV', 'test');
  setEnv('ALLOW_MOCK_ADAPTERS', 'true');
});
