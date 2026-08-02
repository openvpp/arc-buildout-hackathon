import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl, parseSafeExternalUrl } from '@/lib/utils/url';

describe('parseSafeExternalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(
      parseSafeExternalUrl('https://explorer.example/tx/1'),
    ).not.toBeNull();
    expect(parseSafeExternalUrl('http://localhost:4000')).not.toBeNull();
  });

  it('rejects javascript: and data: schemes', () => {
    expect(parseSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(parseSafeExternalUrl('data:text/html,<script></script>')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(parseSafeExternalUrl('not a url')).toBeNull();
  });
});

describe('isSafeExternalUrl', () => {
  it('is a boolean convenience over parseSafeExternalUrl', () => {
    expect(isSafeExternalUrl('https://x.example')).toBe(true);
    expect(isSafeExternalUrl('javascript:void(0)')).toBe(false);
  });
});
