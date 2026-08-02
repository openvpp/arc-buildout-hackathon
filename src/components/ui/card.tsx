import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

/** Generic surface container. Server Component — purely presentational. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white p-5 shadow-sm',
        'dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-sm font-semibold text-slate-900 dark:text-slate-100',
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'mt-1 text-sm text-slate-600 dark:text-slate-400',
        className,
      )}
      {...props}
    />
  );
}
