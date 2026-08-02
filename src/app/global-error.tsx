'use client';

import { useEffect } from 'react';

import { logger } from '@/lib/logger/logger';

/**
 * Global error boundary — replaces the root layout when the layout itself
 * throws, so it must render its own <html>/<body>. Deliberately minimal and
 * self-contained (no app styling guaranteed here). Never exposes stack traces.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('Global error boundary caught an error', {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
        }}
      >
        <div role="alert" style={{ maxWidth: '28rem', padding: '1.5rem' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: '0.5rem', color: '#475569' }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1rem',
              borderRadius: '0.375rem',
              border: '1px solid #cbd5e1',
              padding: '0.5rem 0.875rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
