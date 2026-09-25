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
    'inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
  const variantClass =
    variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-800'
      : 'border border-slate-300 text-slate-900 hover:bg-slate-50';
  return (
    <button
      className={`${base} ${variantClass} ${className ?? ''}`}
      {...props}
    />
  );
}
