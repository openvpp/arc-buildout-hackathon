import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminSnapshot = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('@/features/admin/server', () => ({
  loadAdminSnapshot: () => loadAdminSnapshot(),
}));

describe('AdminPaymentsPage', () => {
  beforeEach(() => {
    loadAdminSnapshot.mockReset();
    vi.resetModules();
  });

  it('lists settled payments', async () => {
    loadAdminSnapshot.mockResolvedValue({
      ok: true as const,
      payments: [
        {
          id: 'pay-1',
          transactionHash:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          verificationStatus: 'confirmed',
          verifiedAt: new Date('2026-01-01T00:05:00.000Z'),
          createdAt: new Date('2026-01-01T00:05:00.000Z'),
          fromAddress: '0x1111111111111111111111111111111111111111',
          toAddress: '0x2222222222222222222222222222222222222222',
          amountDisplay: '0.0004',
          asset: 'USDC',
          requirementStatus: 'consumed',
          deviceId: 'device-1',
          deviceLabel: 'Demo EV',
          walletAddress: '0xabc',
          walletLabel: 'Owner wallet',
          principalDisplayName: 'agent-1',
        },
      ],
      snapshot: [],
    });

    const Page = (await import('@/app/(admin)/admin/(protected)/payments/page'))
      .default;
    render(await Page());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Payments' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0.0004 USDC')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });
});
