/**
 * Telemetry polling — DESIGN SEAM (not active in Phase 1).
 *
 * The autonomous agent polls the backend at a configured interval. The
 * dashboard will eventually mirror a bounded, safe subset of that for live
 * updates. This module documents the intended extension point and returns
 * SAFE, DISABLED defaults so nothing polls by default.
 *
 * When implemented, polling MUST pause/stop when any of the following hold:
 *  - the browser tab is inactive (where a live view is not needed),
 *  - the user is offline,
 *  - a request for the same key is already in flight,
 *  - a payment is awaiting confirmation for that record,
 *  - the configured retry limit has been reached.
 *
 * None of these behaviors are implemented yet. Do not enable real polling until
 * the backend contract (Phase 2) exists.
 */

export type PollingCondition = {
  readonly tabActive: boolean;
  readonly online: boolean;
  readonly requestInFlight: boolean;
  readonly paymentAwaitingConfirmation: boolean;
  readonly retryLimitReached: boolean;
};

export type PollingOptions = {
  /** `false` disables polling; a number is the interval in ms. */
  readonly refetchInterval: number | false;
  readonly refetchIntervalInBackground: boolean;
};

export const DISABLED_POLLING: PollingOptions = {
  refetchInterval: false,
  refetchIntervalInBackground: false,
} as const;

/**
 * Pure predicate for whether polling should currently run. Wired into
 * TanStack Query's `refetchInterval` callback in a future phase.
 */
export function shouldPoll(condition: PollingCondition): boolean {
  return (
    condition.tabActive &&
    condition.online &&
    !condition.requestInFlight &&
    !condition.paymentAwaitingConfirmation &&
    !condition.retryLimitReached
  );
}
