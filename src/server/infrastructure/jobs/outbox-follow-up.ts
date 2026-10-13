export type OutboxJobOutcome =
  // MINT_DEVICE_NFT
  | 'minted'
  | 'already_minted'
  // RECORD_DEVICE_EVENT
  | 'confirmed'
  | 'already_confirmed'
  | 'already_failed'
  | 'waiting_for_mint'
  // both
  | 'busy'
  | 'unconfigured'
  | 'unrecognized'
  | 'error';

export type OutboxFollowUp =
  | { action: 'complete' }
  | {
      action: 'reschedule';
      attempts: number;
      delayMs: number;
      lastError: string | null;
    }
  | {
      action: 'fail';
      attempts: number;
      lastError: string;
      // Mark the job's target (device mint / device event) failed too.
      markTargetFailed: boolean;
    };

const BUSY_DELAY_MS = 15_000;
const UNCONFIGURED_DELAY_MS = 60_000;
// A device event waits for its device's mint; that is not a failure.
const WAITING_FOR_MINT_DELAY_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60_000;

function errorBackoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
}

/**
 * What the worker should do with an outbox row after one attempt.
 * `busy`, `unconfigured` and `waiting_for_mint` are not failures: completing
 * them would drop the only job that can finish the write. An in-flight
 * transaction is retried until it confirms or reverts, instead of sending
 * a second one.
 */
export function decideOutboxFollowUp(input: {
  outcome: OutboxJobOutcome;
  attempts: number;
  maxAttempts: number;
  hasInFlightTransaction: boolean;
  errorMessage: string | null;
}): OutboxFollowUp {
  if (
    input.outcome === 'minted' ||
    input.outcome === 'already_minted' ||
    input.outcome === 'confirmed' ||
    input.outcome === 'already_confirmed' ||
    input.outcome === 'already_failed'
  ) {
    return { action: 'complete' };
  }
  if (input.outcome === 'waiting_for_mint') {
    return {
      action: 'reschedule',
      attempts: input.attempts,
      delayMs: WAITING_FOR_MINT_DELAY_MS,
      lastError: null,
    };
  }
  if (input.outcome === 'busy') {
    return {
      action: 'reschedule',
      attempts: input.attempts,
      delayMs: BUSY_DELAY_MS,
      lastError: null,
    };
  }
  if (input.outcome === 'unconfigured') {
    return {
      action: 'reschedule',
      attempts: input.attempts,
      delayMs: UNCONFIGURED_DELAY_MS,
      lastError: null,
    };
  }
  if (input.outcome === 'unrecognized') {
    return {
      action: 'fail',
      attempts: input.attempts + 1,
      lastError: input.errorMessage ?? 'receipt did not match the device event',
      markTargetFailed: false,
    };
  }

  const attempts = input.attempts + 1;
  const lastError = input.errorMessage ?? 'job failed';
  if (input.hasInFlightTransaction) {
    return {
      action: 'reschedule',
      attempts,
      delayMs: errorBackoffMs(attempts),
      lastError,
    };
  }
  if (attempts >= input.maxAttempts) {
    return {
      action: 'fail',
      attempts,
      lastError,
      markTargetFailed: true,
    };
  }
  return {
    action: 'reschedule',
    attempts,
    delayMs: errorBackoffMs(attempts),
    lastError,
  };
}
