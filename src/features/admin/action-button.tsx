'use client';

import { useActionState } from 'react';

import type { AdminActionState } from './actions';

type Action = (
  previous: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

const INITIAL: AdminActionState = { ok: true, message: null };

/** One admin action as a form: hidden fields, a button, and its outcome. */
export function AdminActionButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'secondary',
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const buttonClass =
    variant === 'primary'
      ? 'rounded-md bg-primary-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-primary-600 disabled:opacity-50'
      : 'rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50';
  return (
    <form action={formAction} className="relative shrink-0">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        className={`grid w-max place-items-center whitespace-nowrap ${buttonClass}`}
      >
        {/* Both labels stay in the layout so the button does not resize. */}
        <span className="invisible col-start-1 row-start-1">{label}</span>
        <span className="invisible col-start-1 row-start-1">
          {pendingLabel}
        </span>
        <span className="col-start-1 row-start-1">
          {pending ? pendingLabel : label}
        </span>
      </button>
      {state.message !== null ? (
        <p
          role="status"
          className={`pointer-events-none absolute top-full right-0 z-20 mt-1 w-64 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-right text-xs ${state.ok ? 'text-slate-400' : 'text-red-400'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
