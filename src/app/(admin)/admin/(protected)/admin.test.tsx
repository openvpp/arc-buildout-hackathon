import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminSnapshot = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('@/features/admin/server', () => ({
  loadAdminSnapshot: () => loadAdminSnapshot(),
}));

describe('AdminHomePage', () => {
  beforeEach(() => {
    loadAdminSnapshot.mockReset();
    vi.resetModules();
  });

  it('renders unavailable state when the backend is offline', async () => {
    loadAdminSnapshot.mockResolvedValue({
      ok: false as const,
      reason: 'database_unavailable' as const,
    });
    const AdminPage = (await import('@/app/(admin)/admin/(protected)/page'))
      .default;
    const ui = await AdminPage();
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Home' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders overview cards with links to section routes', async () => {
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
      snapshot: [
        {
          wallet: {
            id: 'wallet-1',
            address: '0xabc',
            label: 'Owner wallet',
            chainId: 5042002n,
            status: 'active',
          },
          bindings: [
            {
              principalId: 'p1',
              displayName: 'web3auth:subject-1',
              type: 'dashboard_user',
              status: 'active',
              role: 'owner',
            },
          ],
          devices: [
            {
              device: {
                id: 'device-1',
                displayName: 'Demo EV',
                externalDeviceId: 'ext-1',
                vendor: 'DemoOEM',
                model: 'Sedan',
                status: 'active',
                mintStatus: 'minted',
                nftTokenId: '42',
                nftTransactionHash: '0xnfttx',
              },
              latest: {
                contentHash: '0xdeadbeefcafebabe0123456789',
                recordedAt: new Date('2026-01-01T00:00:00.000Z'),
                anchorStatus: 'pending',
              },
              verification: {
                status: 'VERIFIED',
                paymentTransactionHash: '0xpaymenthash0123456789',
              },
              latestVerified: {
                telemetryPayload: {
                  stateOfChargePercent: 10,
                  batteryCapacityKilowattHours: 75,
                },
              },
            },
          ],
        },
      ],
    });

    const AdminPage = (await import('@/app/(admin)/admin/(protected)/page'))
      .default;
    const ui = await AdminPage();
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Home' }),
    ).toBeInTheDocument();
    expect(screen.getByText('67.5 kWh')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View devices' })).toHaveAttribute(
      'href',
      '/admin/devices',
    );
    expect(screen.getByRole('link', { name: 'View payments' })).toHaveAttribute(
      'href',
      '/admin/payments',
    );
    expect(
      screen.getByRole('link', { name: 'View fleet flexibility' }),
    ).toHaveAttribute('href', '/admin/fleet-flexibility');
    expect(
      screen.queryByRole('heading', {
        name: 'Fleet flexibility — charge headroom',
      }),
    ).not.toBeInTheDocument();
  });
});
