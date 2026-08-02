import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ErrorState } from '@/components/common/error-state';

describe('ErrorState', () => {
  it('renders as an alert with a stable, user-safe message', () => {
    render(
      <ErrorState
        title="Could not load the dashboard"
        description="Please try again."
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText('Could not load the dashboard'),
    ).toBeInTheDocument();
  });

  it('invokes onRetry when the retry button is pressed', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when no handler is provided', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
