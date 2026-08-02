'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';

import { isDevelopment } from '@/config/env';
import { createQueryClient } from '@/lib/query/query-client';

/**
 * Provides a single QueryClient per browser session. The client is created lazily
 * in state so it is stable across re-renders and never shared between requests
 * on the server. Devtools are rendered only in development.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {isDevelopment ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
