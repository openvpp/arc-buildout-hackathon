import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminSidebarNav } from '@/features/admin';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/payments',
}));

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: ComponentProps<'a'>) => (
    <a {...rest}>{children}</a>
  ),
}));

describe('AdminSidebarNav', () => {
  it('renders admin section links', () => {
    render(<AdminSidebarNav />);

    expect(
      screen.getByRole('navigation', { name: 'Admin' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/admin',
    );
    expect(
      screen.getByRole('link', { name: 'Fleet flexibility' }),
    ).toHaveAttribute('href', '/admin/fleet-flexibility');
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'href',
      '/admin/payments',
    );
    expect(screen.getByRole('link', { name: 'Devices' })).toHaveAttribute(
      'href',
      '/admin/devices',
    );
  });

  it('marks the current section with aria-current without highlighting Home', () => {
    render(<AdminSidebarNav />);

    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
