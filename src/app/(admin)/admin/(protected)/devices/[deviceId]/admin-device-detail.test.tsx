import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminDeviceDetail = vi.hoisted(() =>
  vi.fn<(deviceId: string) => Promise<unknown>>(),
);

vi.mock('@/features/admin', () => ({
  loadAdminDeviceDetail: (deviceId: string) => loadAdminDeviceDetail(deviceId),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

describe('AdminDeviceDetailPage', () => {
  beforeEach(() => {
    loadAdminDeviceDetail.mockReset();
    vi.resetModules();
  });

  it('renders unlocked telemetry readings for every history row', async () => {
    loadAdminDeviceDetail.mockResolvedValue({
      ok: true as const,
      detail: {
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
        device: {
          id: 'device-1',
          displayName: 'Demo EV',
          externalDeviceId: 'ext-1',
          vendor: 'DemoOEM',
          model: 'Sedan',
          deviceType: 'vehicle',
          status: 'active',
          metadata: { year: 2024, provider: 'enode' },
          lastSeenAt: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2025-12-01T00:00:00.000Z'),
          mintStatus: 'minted',
          nftTokenId: '42',
          nftTransactionHash: '0xnfttx',
          nftContractAddress: '0xnft',
          network: 'arc-testnet',
        },
        latest: {
          id: 't1',
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
            telemetryPayload: {
              stateOfChargePercent: 88,
              isCharging: true,
              isPluggedIn: true,
              rangeKilometers: 320,
              odometerKilometers: 12000,
              chargeRateKilowatts: 11,
            },
            verificationStatus: 'VERIFIED',
            paymentTransactionHash: '0xpaymenthash0123456789',
          },
          {
            id: 't0',
            recordedAt: new Date('2025-12-31T00:00:00.000Z'),
            contentHash: '0xolderhash000000000000000000',
            anchorStatus: 'anchored',
            anchorTransactionHash: '0xanchor',
            telemetryPayload: {
              stateOfChargePercent: 40,
              isCharging: false,
              isPluggedIn: false,
              rangeKilometers: 150,
              odometerKilometers: 11900,
              chargeRateKilowatts: null,
            },
            verificationStatus: null,
            paymentTransactionHash: null,
          },
        ],
      },
    });

    const AdminDeviceDetailPage = (
      await import('@/app/(admin)/admin/(protected)/devices/[deviceId]/page')
    ).default;
    const ui = await AdminDeviceDetailPage({
      params: Promise.resolve({ deviceId: 'device-1' }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Demo EV' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/web3auth:subject-1 · dashboard_user · owner/),
    ).toBeInTheDocument();
    expect(screen.getByText('Telemetry history (2)')).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Settled')).toBeInTheDocument();
    expect(screen.getByText('Unpaid')).toBeInTheDocument();
    expect(
      screen.getByText(/Readings are still shown for admin inspection/),
    ).toBeInTheDocument();
  });
});
