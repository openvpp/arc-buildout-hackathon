'use client';

import { Button } from '@/components/ui/button';

/**
 * Safe, user-facing error component.
 *
 * Shows a stable, human-readable message. It NEVER renders raw error objects,
 * stack traces, or internal details — those go to the logger, not the UI.
 * An optional retry action lets route-level `error.tsx` recover.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'An unexpected error occurred. Please try again.',
  onRetry,
  retryLabel = 'Try again',
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center dark:border-red-900 dark:bg-red-950/40"
    >
      <p className="text-sm font-semibold text-red-900 dark:text-red-200">
        {title}
      </p>
      <p className="mt-1 max-w-md text-sm text-red-800 dark:text-red-300">
        {description}
      </p>
      {onRetry ? (
        <Button className="mt-4" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
