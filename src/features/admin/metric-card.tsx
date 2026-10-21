import Link from 'next/link';

const TONE = {
  neutral: 'text-slate-100',
  success: 'text-primary-400',
  warning: 'text-amber-300',
  danger: 'text-red-400',
} as const;

export function AdminMetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: keyof typeof TONE;
  href?: string;
}) {
  const body = (
    <div className="flex h-full flex-col gap-1 rounded-md border border-slate-800 bg-slate-900 p-4">
      <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </span>
      <span className={`text-2xl font-semibold tabular-nums ${TONE[tone]}`}>
        {value}
      </span>
      {hint !== undefined ? (
        <span className="text-xs text-slate-500">{hint}</span>
      ) : null}
    </div>
  );
  return href === undefined ? (
    body
  ) : (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  );
}
