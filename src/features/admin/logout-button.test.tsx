import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminLogoutButton } from './logout-button';

describe('AdminLogoutButton', () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigates to the admin logout path', async () => {
    const user = userEvent.setup();
    render(<AdminLogoutButton />);

    await user.click(screen.getByRole('button', { name: 'Log out' }));

    expect(assign).toHaveBeenCalledWith('/admin/logout');
  });
});
