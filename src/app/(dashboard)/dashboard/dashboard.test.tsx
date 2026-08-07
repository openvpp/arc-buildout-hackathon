import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardError from '@/app/(dashboard)/dashboard/error';

const loadDashboardSnapshot = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('@/features/dashboard', () => ({
  loadDashboardSnapshot: () => loadDashboardSnapshot(),
  RequestTelemetryPanel: () => (
    <div data-testid="request-telemetry-panel">Request panel</div>
  ),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    loadDashboardSnapshot.mockReset();
    vi.resetModules();
  });

  it('renders unavailable state when the backend is offline', async () => {
    loadDashboardSnapshot.mockResolvedValue({
      ok: false as const,
      reason: 'database_unavailable' as const,
    });
    const DashboardPage = (await import('@/app/(dashboard)/dashboard/page'))
      .default;
    const ui = await DashboardPage();
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('keeps device telemetry locked until request/pay panel unlocks it', async () => {
    loadDashboardSnapshot.mockResolvedValue({
      ok: true as const,
      snapshot: [
        {
          wallet: {
            id: 'wallet-1',
            address: '0xabc',
            label: 'Demo wallet',
          },
          devices: [
            {
              device: {
                id: 'device-1',
                displayName: 'Demo Device',
                externalDeviceId: 'ext-1',
                vendor: 'DemoOEM',
                model: 'Sedan',
                status: 'active',
                mintStatus: 'unminted',
              },
              latest: {
                telemetryPayload: { stateOfChargePercent: 88 },
                contentHash: '0xdead',
                recordedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
              verification: {
                status: 'VERIFIED',
                paymentTransactionHash: '0xpay',
              },
            },
          ],
        },
      ],
    });

    const DashboardPage = (await import('@/app/(dashboard)/dashboard/page'))
      .default;
    const ui = await DashboardPage();
    render(ui);

    expect(screen.getByText('Devices — request & unlock')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('Verified records')).toBeInTheDocument();
    expect(screen.queryByText(/0xdead/)).not.toBeInTheDocument();
    expect(screen.getByTestId('request-telemetry-panel')).toBeInTheDocument();
  });
});

describe('DashboardError', () => {
  it('renders an alert and recovers via the reset handler', async () => {
    const reset = vi.fn();
    render(<DashboardError error={new Error('boom')} reset={reset} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Could not load the dashboard'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
