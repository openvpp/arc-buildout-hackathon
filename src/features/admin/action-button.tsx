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
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        className={
          variant === 'primary'
            ? 'rounded-md bg-primary-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-primary-600 disabled:opacity-50'
            : 'rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50'
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {state.message !== null ? (
        <p
          role="status"
          className={`text-xs ${state.ok ? 'text-slate-400' : 'text-red-400'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
