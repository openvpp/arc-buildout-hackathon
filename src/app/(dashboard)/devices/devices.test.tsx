import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadDashboardSnapshot = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock('@/features/dashboard', () => ({
  loadDashboardSnapshot: () => loadDashboardSnapshot(),
}));

describe('DevicesPage', () => {
  beforeEach(() => {
    loadDashboardSnapshot.mockReset();
    vi.resetModules();
  });

  it('renders device details beyond the name', async () => {
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
                displayName: 'Garage EV',
                externalDeviceId: 'ext-ev-1',
                vendor: 'DemoOEM',
                model: 'Sport',
                deviceType: 'vehicle',
                status: 'active',
                mintStatus: 'unminted',
                metadata: { year: 2024, provider: 'enode' },
                lastSeenAt: new Date('2026-03-01T12:00:00.000Z'),
              },
              latest: {
                recordedAt: new Date('2026-03-01T12:00:00.000Z'),
                contentHash: 'aabbccddeeff00112233445566778899',
                anchorStatus: 'PENDING',
              },
              verification: null,
            },
          ],
        },
      ],
    });

    const DevicesPage = (await import('@/app/(dashboard)/devices/page'))
      .default;
    const ui = await DevicesPage();
    render(ui);

    expect(screen.getByText('Garage EV')).toBeInTheDocument();
    expect(screen.getByText(/DemoOEM · Sport · 2024/)).toBeInTheDocument();
    expect(screen.getByText('ext-ev-1')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.queryByText(/mint /i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View vehicle & telemetry' }),
    ).toHaveAttribute('href', '/devices/device-1');
  });

  it('links to Arc explorer when a mint tx exists', async () => {
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
                displayName: 'Garage EV',
                externalDeviceId: 'ext-ev-1',
                vendor: 'DemoOEM',
                model: 'Sport',
                deviceType: 'vehicle',
                status: 'active',
                mintStatus: 'minted',
                nftTokenId: '42',
                nftTransactionHash:
                  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                metadata: { year: 2024, provider: 'enode' },
                lastSeenAt: new Date('2026-03-01T12:00:00.000Z'),
              },
              latest: null,
              verification: null,
            },
          ],
        },
      ],
    });

    const DevicesPage = (await import('@/app/(dashboard)/devices/page'))
      .default;
    const ui = await DevicesPage();
    render(ui);

    expect(
      screen.getByRole('link', { name: /View mint transaction/i }),
    ).toHaveAttribute(
      'href',
      'https://explorer.test.example/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });
});
