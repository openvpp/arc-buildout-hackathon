import { describe, expect, it } from 'vitest';

import { dashboardPrincipalDisplayName } from '@/server/application/onboarding/bind-dashboard-owner';

describe('dashboardPrincipalDisplayName', () => {
  it('prefers verified email over JWT subject', () => {
    expect(
      dashboardPrincipalDisplayName({
        subject: 'google-oauth-sub-123',
        email: 'Ahmad.Suddle@gmail.com',
      }),
    ).toBe('web3auth:ahmad.suddle@gmail.com');
  });

  it('falls back to subject when email is missing', () => {
    expect(
      dashboardPrincipalDisplayName({
        subject: 'user-sub',
        email: null,
      }),
    ).toBe('web3auth:user-sub');
  });
});
