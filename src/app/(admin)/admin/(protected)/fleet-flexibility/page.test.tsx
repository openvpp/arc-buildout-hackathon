import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAdminSnapshot = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('@/features/admin/server', () => ({
  loadAdminSnapshot: () => loadAdminSnapshot(),
}));

describe('AdminFleetFlexibilityPage', () => {
  beforeEach(() => {
    loadAdminSnapshot.mockReset();
    vi.resetModules();
  });

  it('renders unavailable state when the backend is offline', async () => {
    loadAdminSnapshot.mockResolvedValue({
      ok: false as const,
      reason: 'database_unavailable' as const,
    });
    const AdminFleetFlexibilityPage = (
      await import('@/app/(admin)/admin/(protected)/fleet-flexibility/page')
    ).default;
    const ui = await AdminFleetFlexibilityPage();
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Fleet flexibility' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('explains the demo metric and shows vehicle headroom with trust badges', async () => {
    loadAdminSnapshot.mockResolvedValue({
      ok: true as const,
      payments: [],
      snapshot: [
        {
          wallet: {
            id: 'wallet-1',
            address: '0xabc',
            label: 'Owner wallet',
            chainId: 5042002n,
            status: 'active',
          },
          bindings: [],
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
            {
              device: {
                id: 'device-2',
                displayName: 'Fallback EV',
                externalDeviceId: 'ext-2',
                vendor: 'DemoOEM',
                model: 'Hatch',
                status: 'active',
                mintStatus: 'not_minted',
                nftTokenId: null,
                nftTransactionHash: null,
              },
              latest: {
                contentHash: '0xfeed',
                recordedAt: new Date('2026-01-01T00:01:00.000Z'),
                anchorStatus: 'pending',
                telemetryPayload: {
                  stateOfChargePercent: 50,
                  batteryCapacityKilowattHours: 60,
                },
              },
              verification: null,
              latestVerified: null,
            },
          ],
        },
      ],
    });

    const AdminFleetFlexibilityPage = (
      await import('@/app/(admin)/admin/(protected)/fleet-flexibility/page')
    ).default;
    const ui = await AdminFleetFlexibilityPage();
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Fleet flexibility' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/usable grid signal/i)).toBeInTheDocument();
    expect(screen.getByText(/How to read this/i)).toBeInTheDocument();
    expect(
      screen.getByText(/headroom = \(1 − SoC\) × pack kWh/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Total fleet headroom').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('97.5 kWh').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Demo EV' })).toHaveAttribute(
      'href',
      '/admin/devices/device-1',
    );
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Latest unlocked')).toBeInTheDocument();
  });
});
