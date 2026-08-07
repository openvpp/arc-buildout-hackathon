import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from './theme';
import { ThemePreferenceControl } from './theme-preference-control';
import { ThemeProvider } from './theme-provider';

function renderControl() {
  return render(
    <ThemeProvider>
      <ThemePreferenceControl />
    </ThemeProvider>,
  );
}

describe('ThemePreferenceControl', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders light, dark, and system options', async () => {
    renderControl();
    expect(
      await screen.findByRole('radio', { name: /Light/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Dark/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /System/i })).toBeInTheDocument();
  });

  it('persists dark preference and applies the dark class', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('radio', { name: /Dark/i }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('radio', { name: /Dark/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
