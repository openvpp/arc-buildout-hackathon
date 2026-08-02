import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import DashboardError from '@/app/(dashboard)/dashboard/error';

vi.mock('@/features/dashboard', () => ({
  loadDashboardSnapshot: vi.fn(async () => ({
    ok: false as const,
    reason: 'database_unavailable' as const,
  })),
}));

describe('DashboardPage', () => {
  it('renders unavailable state when the backend is offline', async () => {
    const DashboardPage = (await import('@/app/(dashboard)/dashboard/page'))
      .default;
    const ui = await DashboardPage();
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Backend data unavailable')).toBeInTheDocument();
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
