import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

export type ButtonVariant = 'primary' | 'secondary';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
  secondary:
    'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/**
 * Styled button. Presentational only — attaches no behavior itself, so it stays
 * a Server Component and callers supply handlers from Client Components.
 */
export function Button({
  variant = 'primary',
  className,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium',
        'transition-colors focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-slate-950',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}
