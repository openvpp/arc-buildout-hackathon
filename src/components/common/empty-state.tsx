import type { ReactNode } from 'react';

/**
 * Explicit empty-state pattern. Every data surface must render a deliberate
 * empty state (not a blank region) so "no data" is clearly communicated.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700"
      role="status"
    >
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {title}
      </p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
