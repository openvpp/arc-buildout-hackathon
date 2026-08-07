import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SidebarNav } from '@/components/layout/sidebar-nav';

// vitest hoists vi.mock above the imports above, so the mocks are in place
// before `SidebarNav` (and its next/* imports) are evaluated.
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

// Forward ALL anchor props (incl. aria-current, className) so the mock behaves
// like next/link for accessibility assertions.
vi.mock('next/link', () => ({
  default: ({ children, ...rest }: ComponentProps<'a'>) => (
    <a {...rest}>{children}</a>
  ),
}));

describe('SidebarNav', () => {
  it('renders the primary navigation landmark with all links', () => {
    render(<SidebarNav />);

    expect(
      screen.getByRole('navigation', { name: 'Primary' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Devices' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Wallets' }),
    ).not.toBeInTheDocument();
  });

  it('marks the current route with aria-current="page"', () => {
    render(<SidebarNav />);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Devices' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
