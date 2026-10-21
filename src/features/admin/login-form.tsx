'use client';

import { useActionState } from 'react';

import { loginAdmin, type AdminLoginState } from './login-action';

const INITIAL_STATE: AdminLoginState = { error: null };

const INPUT_CLASS =
  'rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

/** Admin username/password form; the server action sets the session cookie. */
export function AdminLoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(
    loginAdmin,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={nextPath} />
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="admin-username"
          className="text-sm font-medium text-slate-200"
        >
          Username
        </label>
        <input
          id="admin-username"
          name="username"
          type="text"
          autoComplete="username"
          required
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="admin-password"
          className="text-sm font-medium text-slate-200"
        >
          Password
        </label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={INPUT_CLASS}
        />
      </div>
      {state.error !== null ? (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-primary-600 disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
