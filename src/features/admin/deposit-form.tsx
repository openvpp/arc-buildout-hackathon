'use client';

import { useActionState } from 'react';

import type { AdminActionState } from './actions';
import { depositToGatewayAction } from './payment-actions';

const INITIAL: AdminActionState = { ok: true, message: null };

/** Deposit USDC from the payer wallet into Gateway (on-chain, confirmed). */
export function DepositForm({
  payerAddress,
}: {
  readonly payerAddress: string;
}) {
  const [state, formAction, pending] = useActionState(
    depositToGatewayAction,
    INITIAL,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2 text-xs">
      <label htmlFor="deposit-amount" className="text-slate-300">
        Deposit from the payer wallet into Circle Gateway (USDC)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="deposit-amount"
          name="amount"
          inputMode="decimal"
          defaultValue="0.5"
          className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-100"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary-500 px-3 py-1.5 font-semibold text-black hover:bg-primary-600 disabled:opacity-50"
        >
          {pending ? 'Depositing…' : 'Deposit'}
        </button>
      </div>
      <label className="flex items-start gap-2 text-slate-400">
        <input
          id="deposit-confirm"
          type="checkbox"
          name="confirm"
          value="yes"
          className="mt-0.5"
        />
        <span>
          I understand this sends an on-chain transaction from{' '}
          <span className="font-mono">{payerAddress}</span>.
        </span>
      </label>
      {state.message !== null ? (
        <p
          role="status"
          className={state.ok ? 'text-slate-400' : 'text-red-400'}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
