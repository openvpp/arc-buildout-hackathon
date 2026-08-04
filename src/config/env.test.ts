import { describe, expect, it } from 'vitest';

import { parseEnv, type RawEnv } from '@/config/env';

const validEnv: RawEnv = {
  NEXT_PUBLIC_APP_NAME: 'Example App',
  NEXT_PUBLIC_APP_ENV: 'test',
  NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000',
  NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: 'https://explorer.example',
  NEXT_PUBLIC_WEB3AUTH_CLIENT_ID: '',
  NEXT_PUBLIC_WEB3AUTH_NETWORK: 'sapphire_devnet',
};

describe('parseEnv', () => {
  it('parses a fully valid environment', () => {
    const env = parseEnv(validEnv);
    expect(env.NEXT_PUBLIC_APP_ENV).toBe('test');
    expect(env.NEXT_PUBLIC_APP_NAME).toBe('Example App');
  });

  it('fails fast when the app name is empty', () => {
    expect(() => parseEnv({ ...validEnv, NEXT_PUBLIC_APP_NAME: '' })).toThrow(
      /NEXT_PUBLIC_APP_NAME/,
    );
  });

  it('rejects an unknown app environment', () => {
    expect(() =>
      parseEnv({ ...validEnv, NEXT_PUBLIC_APP_ENV: 'staging-typo' }),
    ).toThrow(/environment/i);
  });

  it('rejects an invalid API base URL', () => {
    expect(() =>
      parseEnv({ ...validEnv, NEXT_PUBLIC_API_BASE_URL: 'not-a-url' }),
    ).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
  });

  it('rejects a missing explorer URL', () => {
    expect(() =>
      parseEnv({ ...validEnv, NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: undefined }),
    ).toThrow();
  });
});
