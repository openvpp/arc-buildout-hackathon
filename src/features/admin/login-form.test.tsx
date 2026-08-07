import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./login-action', () => ({
  loginAdmin: vi.fn(async () => ({ error: null })),
}));

import { AdminLoginForm } from './login-form';

describe('AdminLoginForm', () => {
  it('renders username, password, and submit controls', () => {
    render(<AdminLoginForm nextPath="/admin" />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('/admin')).toBeInTheDocument();
  });
});
