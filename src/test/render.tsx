import { QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { createQueryClient } from '@/lib/query/query-client';

/**
 * Render a component wrapped in the app's client providers (currently just
 * TanStack Query, with a fresh client per test for isolation). Use for
 * component/integration tests that touch query state.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const queryClient = createQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
