'use client';

import { useActionState } from 'react';

import { unlockEventAction, type UnlockActionState } from './actions';

const INITIAL: UnlockActionState = { ok: true, message: null };

/** Pay a nanopayment on Arc to unlock one event. */
export function UnlockButton({
  eventId,
  deviceId,
  priceLabel,
}: {
  readonly eventId: string;
  readonly deviceId: string;
  /** e.g. "0.001 USDC". */
  readonly priceLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    unlockEventAction,
    INITIAL,
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="deviceId" value={deviceId} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-primary-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-primary-600 disabled:opacity-50"
      >
        {pending ? 'Paying on Arc…' : `Unlock · ${priceLabel}`}
      </button>
      {state.message !== null ? (
        <p
          role="status"
          className={`text-xs ${state.ok ? 'text-white/60' : 'text-red-400'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
