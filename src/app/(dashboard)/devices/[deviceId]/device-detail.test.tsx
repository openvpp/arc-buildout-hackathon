import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDeviceDetail = vi.hoisted(() =>
  vi.fn<(deviceId: string) => Promise<unknown>>(),
);

vi.mock('@/features/dashboard', () => ({
  loadDeviceDetail: (deviceId: string) => loadDeviceDetail(deviceId),
}));

describe('DeviceDetailPage', () => {
  beforeEach(() => {
    loadDeviceDetail.mockReset();
    vi.resetModules();
  });

  it('renders vehicle fields and metadata-only telemetry history cards', async () => {
    loadDeviceDetail.mockResolvedValue({
      ok: true as const,
      detail: {
        wallet: {
          id: 'wallet-1',
          address: '0xabcabcabcabcabcabcabcabcabcabcabcabcabcd',
          label: 'Demo wallet',
          chainId: 5042002n,
          status: 'active',
        },
        device: {
          id: 'device-1',
          displayName: 'Garage EV',
          externalDeviceId: 'ext-ev-1',
          vendor: 'DemoOEM',
          model: 'Sport',
          deviceType: 'vehicle',
          status: 'active',
          mintStatus: 'minted',
          metadata: { year: 2024, provider: 'enode' },
          lastSeenAt: new Date('2026-03-01T12:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          nftTokenId: '42',
          nftContractAddress: '0xnft',
          nftTransactionHash:
            '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          network: 'arc-testnet',
        },
        latest: {
          id: 'rec-latest',
          recordedAt: new Date('2026-03-02T00:00:00.000Z'),
          contentHash: 'hash-latest-0123456789abcdef',
          anchorStatus: 'PENDING',
          anchorTransactionHash: null,
          telemetryPayload: { stateOfChargePercent: 99 },
        },
        verification: { status: 'VERIFIED', paymentTransactionHash: '0xpay' },
        history: [
          {
            id: 'rec-1',
            recordedAt: new Date('2026-03-02T00:00:00.000Z'),
            contentHash: 'hash-latest-0123456789abcdef',
            anchorStatus: 'PENDING',
            anchorTransactionHash: null,
          },
          {
            id: 'rec-0',
            recordedAt: new Date('2026-03-01T00:00:00.000Z'),
            contentHash: 'hash-older-0123456789abcdef00',
            anchorStatus: 'ANCHORED',
            anchorTransactionHash: '0xanchorhashABCDEF',
          },
        ],
      },
    });

    const DeviceDetailPage = (
      await import('@/app/(dashboard)/devices/[deviceId]/page')
    ).default;
    const ui = await DeviceDetailPage({
      params: Promise.resolve({ deviceId: 'device-1' }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Garage EV' }),
    ).toBeInTheDocument();
    expect(screen.getByText('DemoOEM')).toBeInTheDocument();
    expect(screen.getByText('Sport')).toBeInTheDocument();
    expect(screen.getByText('ext-ev-1')).toBeInTheDocument();
    expect(screen.getByText('Telemetry history (2)')).toBeInTheDocument();
    expect(screen.getByText('Not anchored')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /View mint transaction/i }),
    ).toHaveAttribute(
      'href',
      'https://explorer.test.example/tx/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(screen.queryByText(/stateOfCharge/i)).not.toBeInTheDocument();
  });
});
