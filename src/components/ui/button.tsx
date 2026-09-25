import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const variantClass =
    variant === 'primary'
      ? 'border border-primary-500 text-primary-500 hover:bg-primary-500/10'
      : 'border border-white/15 text-white/80 hover:bg-white/5';
  return (
    <button
      className={`${base} ${variantClass} ${className ?? ''}`}
      {...props}
    />
  );
}
