import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminSnapshot = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('@/features/admin', () => ({
  loadAdminSnapshot: () => loadAdminSnapshot(),
}));

describe('AdminPage', () => {
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
      screen.getByRole('heading', { level: 1, name: 'Super Admin' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders wallets, principals, latest telemetry, and history', async () => {
    loadAdminSnapshot.mockResolvedValue({
      ok: true as const,
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
              history: [
                {
                  id: 't1',
                  recordedAt: new Date('2026-01-01T00:00:00.000Z'),
                  contentHash: '0xdeadbeefcafebabe0123456789',
                  anchorStatus: 'pending',
                  anchorTransactionHash: null,
                },
                {
                  id: 't0',
                  recordedAt: new Date('2025-12-31T00:00:00.000Z'),
                  contentHash: '0xolderhash000000000000000000',
                  anchorStatus: 'anchored',
                  anchorTransactionHash: '0xanchor',
                },
              ],
            },
          ],
        },
      ],
    });

    const AdminPage = (await import('@/app/(admin)/admin/(protected)/page'))
      .default;
    const ui = await AdminPage();
    render(ui);

    expect(screen.getByText('Owner wallet')).toBeInTheDocument();
    expect(
      screen.getByText(/web3auth:subject-1 · dashboard_user · owner/),
    ).toBeInTheDocument();
    expect(screen.getByText('Demo EV')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('Recent history (2)')).toBeInTheDocument();
    expect(screen.getAllByText('device event pending').length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('device event anchored')).toBeInTheDocument();
  });
});
