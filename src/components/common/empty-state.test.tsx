import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from '@/components/common/empty-state';

describe('EmptyState', () => {
  it('renders the title and description as a status region', () => {
    render(
      <EmptyState
        title="No telemetry to display"
        description="Live telemetry is not available in Phase 1."
      />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No telemetry to display')).toBeInTheDocument();
    expect(
      screen.getByText('Live telemetry is not available in Phase 1.'),
    ).toBeInTheDocument();
  });
});
