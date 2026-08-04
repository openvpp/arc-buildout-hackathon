import { describe, expect, it } from 'vitest';

import {
  extractClientIp,
  isIpAllowed,
  parseIpAllowlist,
} from '@/server/infrastructure/http/ip-allowlist';

describe('ip allowlist', () => {
  it('parses comma-separated entries', () => {
    expect(parseIpAllowlist(' 1.2.3.4, 10.0.0.0/8 ')).toEqual([
      '1.2.3.4',
      '10.0.0.0/8',
    ]);
  });

  it('allows all when allowlist is empty', () => {
    expect(isIpAllowed(undefined, [])).toBe(true);
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('rejects missing IP when allowlist is set', () => {
    expect(isIpAllowed(undefined, ['1.2.3.4'])).toBe(false);
  });

  it('matches exact IPv4', () => {
    expect(isIpAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
    expect(isIpAllowed('1.2.3.5', ['1.2.3.4'])).toBe(false);
  });

  it('matches IPv4 CIDR', () => {
    expect(isIpAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
  });

  it('extracts first x-forwarded-for hop', () => {
    const request = new Request('http://localhost/api/webhooks/enode', {
      headers: {
        'x-forwarded-for': '198.51.100.10, 203.0.113.1',
      },
    });
    expect(extractClientIp(request)).toBe('198.51.100.10');
  });
});
