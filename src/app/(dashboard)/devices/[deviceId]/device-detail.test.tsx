import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDeviceDetail = vi.hoisted(() =>
  vi.fn<(deviceId: string) => Promise<unknown>>(),
);

vi.mock('@/features/dashboard', () => ({
  loadDeviceDetail: (deviceId: string) => loadDeviceDetail(deviceId),
  RequestTelemetryPanel: () => (
    <div data-testid="request-telemetry-panel">Request panel</div>
  ),
  VerifyTelemetryButton: (props: { readonly telemetryRecordId: string }) => (
    <button type="button" data-testid={`verify-${props.telemetryRecordId}`}>
      Verify on Arc
    </button>
  ),
}));

describe('DeviceDetailPage', () => {
  beforeEach(() => {
    loadDeviceDetail.mockReset();
    vi.resetModules();
  });

  it('shows full readings only for paid records; unpaid stays compact', async () => {
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
          anchorStatus: 'pending',
          anchorTransactionHash: null,
          telemetryPayload: { stateOfChargePercent: 99 },
        },
        verification: { status: 'VERIFIED', paymentTransactionHash: '0xpay' },
        history: [
          {
            id: 'rec-1',
            recordedAt: new Date('2026-03-02T00:00:00.000Z'),
            contentHash: 'hash-latest-0123456789abcdef',
            anchorStatus: 'pending',
            anchorTransactionHash: null,
            telemetryPayload: {
              stateOfChargePercent: 99,
              isCharging: true,
              rangeKilometers: 220,
            },
            verificationStatus: null,
            paymentTransactionHash:
              '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          },
          {
            id: 'rec-unpaid',
            recordedAt: new Date('2026-03-01T12:00:00.000Z'),
            contentHash: 'hash-unpaid-0123456789abcdef01',
            anchorStatus: 'unanchored',
            anchorTransactionHash: null,
            telemetryPayload: {
              stateOfChargePercent: 12,
              isCharging: false,
            },
            verificationStatus: null,
            paymentTransactionHash: null,
          },
          {
            id: 'rec-0',
            recordedAt: new Date('2026-03-01T00:00:00.000Z'),
            contentHash: 'hash-older-0123456789abcdef00',
            anchorStatus: 'anchored',
            anchorTransactionHash:
              '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
            telemetryPayload: {
              stateOfChargePercent: 40,
              isCharging: false,
            },
            verificationStatus: 'VERIFIED',
            paymentTransactionHash: 'b887267c-04ff-4bc9-8c1e-6d0c053119b2',
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
    expect(screen.getByText('Telemetry history (3)')).toBeInTheDocument();
    expect(screen.getByText('99%')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('220 km')).toBeInTheDocument();
    expect(screen.queryByText('12%')).not.toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(
      screen.getByText(/Readings stay locked until this record is paid/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('verify-rec-1')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-rec-unpaid')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /View mint transaction/i }),
    ).toBeInTheDocument();
  });
});
