export type MintJobOutcome =
  'minted' | 'already_minted' | 'busy' | 'unconfigured' | 'error';

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
      markDeviceFailed: boolean;
    };

const BUSY_DELAY_MS = 15_000;
const UNCONFIGURED_DELAY_MS = 60_000;
const MAX_BACKOFF_MS = 60_000;

function errorBackoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, MAX_BACKOFF_MS);
}

/**
 * What the worker should do with an outbox row after one mint attempt.
 * `busy` and `unconfigured` are not failures: completing them would drop
 * the only job that can finish the mint. An in-flight transaction is
 * retried until it confirms or reverts, instead of minting a second NFT.
 */
export function decideOutboxFollowUp(input: {
  outcome: MintJobOutcome;
  attempts: number;
  maxAttempts: number;
  hasInFlightTransaction: boolean;
  errorMessage: string | null;
}): OutboxFollowUp {
  if (input.outcome === 'minted' || input.outcome === 'already_minted') {
    return { action: 'complete' };
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

  const attempts = input.attempts + 1;
  const lastError = input.errorMessage ?? 'mint failed';
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
      markDeviceFailed: true,
    };
  }
  return {
    action: 'reschedule',
    attempts,
    delayMs: errorBackoffMs(attempts),
    lastError,
  };
}
