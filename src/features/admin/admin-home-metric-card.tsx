import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

const TONES = {
  sky: {
    card: 'border-sky-200/80 bg-gradient-to-br from-sky-50 to-sky-100/70 dark:border-sky-900/60 dark:from-sky-950/50 dark:to-slate-900',
    label: 'text-sky-800 dark:text-sky-200',
    value: 'text-sky-950 dark:text-sky-50',
    meta: 'text-sky-700/80 dark:text-sky-300/80',
    accent: 'bg-sky-500',
    link: 'text-sky-800 hover:text-sky-950 dark:text-sky-200 dark:hover:text-sky-50',
  },
  emerald: {
    card: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-teal-50/80 dark:border-emerald-900/60 dark:from-emerald-950/40 dark:to-slate-900',
    label: 'text-emerald-800 dark:text-emerald-200',
    value: 'text-emerald-950 dark:text-emerald-50',
    meta: 'text-emerald-700/80 dark:text-emerald-300/80',
    accent: 'bg-emerald-500',
    link: 'text-emerald-800 hover:text-emerald-950 dark:text-emerald-200 dark:hover:text-emerald-50',
  },
  amber: {
    card: 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/70 dark:border-amber-900/50 dark:from-amber-950/35 dark:to-slate-900',
    label: 'text-amber-900 dark:text-amber-200',
    value: 'text-amber-950 dark:text-amber-50',
    meta: 'text-amber-800/75 dark:text-amber-300/80',
    accent: 'bg-amber-500',
    link: 'text-amber-900 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50',
  },
  slate: {
    card: 'border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100/80 dark:border-slate-700 dark:from-slate-900 dark:to-slate-950',
    label: 'text-slate-700 dark:text-slate-300',
    value: 'text-slate-950 dark:text-slate-50',
    meta: 'text-slate-600 dark:text-slate-400',
    accent: 'bg-slate-500',
    link: 'text-slate-800 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white',
  },
  cyan: {
    card: 'border-cyan-200/80 bg-gradient-to-br from-cyan-50 to-sky-50/80 dark:border-cyan-900/50 dark:from-cyan-950/40 dark:to-slate-900',
    label: 'text-cyan-800 dark:text-cyan-200',
    value: 'text-cyan-950 dark:text-cyan-50',
    meta: 'text-cyan-700/80 dark:text-cyan-300/80',
    accent: 'bg-cyan-500',
    link: 'text-cyan-800 hover:text-cyan-950 dark:text-cyan-200 dark:hover:text-cyan-50',
  },
  lime: {
    card: 'border-lime-200/80 bg-gradient-to-br from-lime-50 to-emerald-50/70 dark:border-lime-900/40 dark:from-lime-950/30 dark:to-slate-900',
    label: 'text-lime-900 dark:text-lime-200',
    value: 'text-lime-950 dark:text-lime-50',
    meta: 'text-lime-800/75 dark:text-lime-300/80',
    accent: 'bg-lime-500',
    link: 'text-lime-900 hover:text-lime-950 dark:text-lime-200 dark:hover:text-lime-50',
  },
} as const;

export type AdminHomeTone = keyof typeof TONES;

/**
 * Soft-tinted overview metric tile for the Super Admin home screen.
 */
export function AdminHomeMetricCard({
  title,
  value,
  meta,
  href,
  linkLabel,
  tone,
}: {
  readonly title: string;
  readonly value: ReactNode;
  readonly meta?: ReactNode;
  readonly href?: string;
  readonly linkLabel?: string;
  readonly tone: AdminHomeTone;
}) {
  const styles = TONES[tone];

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-xl border p-5 shadow-sm transition duration-200',
        'hover:-translate-y-0.5 hover:shadow-md',
        styles.card,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-1 opacity-90 transition group-hover:opacity-100',
          styles.accent,
        )}
      />
      <h3
        className={cn(
          'text-xs font-semibold tracking-wide uppercase',
          styles.label,
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          'mt-3 text-3xl font-semibold tracking-tight',
          styles.value,
        )}
      >
        {value}
      </p>
      {meta !== undefined ? (
        <div className={cn('mt-2 text-xs leading-relaxed', styles.meta)}>
          {meta}
        </div>
      ) : null}
      {href !== undefined && linkLabel !== undefined ? (
        <Link
          href={href}
          className={cn(
            'mt-4 inline-flex text-xs font-semibold underline decoration-2 underline-offset-4 transition',
            styles.link,
          )}
        >
          {linkLabel}
        </Link>
      ) : null}
    </article>
  );
}
