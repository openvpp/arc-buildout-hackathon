'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/common/error-state';
import { logger } from '@/lib/logger/logger';

/**
 * Root route error boundary. Logs the failure (message + digest only, never the
 * full stack to the UI) and offers recovery via `reset`.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('Root error boundary caught an error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl items-center px-6">
      <div className="w-full">
        <ErrorState onRetry={reset} />
      </div>
    </div>
  );
}
