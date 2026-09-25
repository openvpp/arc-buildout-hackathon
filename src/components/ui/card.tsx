import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className ?? ''}`}
      {...props}
    />
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-900">{children}</h3>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-slate-600">{children}</p>;
}
