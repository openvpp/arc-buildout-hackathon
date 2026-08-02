import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export type StatusTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  success:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
};

/**
 * Small labelled status indicator. Presentational Server Component. Includes a
 * visually-hidden prefix so screen readers announce it as a status, not a bare
 * word.
 */
export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
      )}
    >
      <span className="sr-only">Status: </span>
      {children}
    </span>
  );
}
