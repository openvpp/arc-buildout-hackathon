import { describe, expect, it } from 'vitest';

import { parseEnv } from '@/config/env';

describe('web3auth env', () => {
  it('defaults network to sapphire_devnet and allows empty client id', () => {
    const parsed = parseEnv({
      NEXT_PUBLIC_APP_NAME: 'Example App',
      NEXT_PUBLIC_APP_ENV: 'test',
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000',
      NEXT_PUBLIC_ARC_EXPLORER_BASE_URL: 'https://explorer.example',
      NEXT_PUBLIC_WEB3AUTH_CLIENT_ID: undefined,
      NEXT_PUBLIC_WEB3AUTH_NETWORK: undefined,
    });
    expect(parsed.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID).toBe('');
    expect(parsed.NEXT_PUBLIC_WEB3AUTH_NETWORK).toBe('sapphire_devnet');
  });
});
