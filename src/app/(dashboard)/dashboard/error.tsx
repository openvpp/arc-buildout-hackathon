'use client';

import { useEffect } from 'react';

import { ErrorState } from '@/components/common/error-state';
import { logger } from '@/lib/logger/logger';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('Dashboard error boundary caught an error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <ErrorState
      title="Could not load the dashboard"
      description="An unexpected error occurred while loading dashboard data. Please try again."
      onRetry={reset}
    />
  );
}
