/**
 * Thrown when on-chain provenance cannot run yet (e.g. DeviceNFT not minted).
 * Workers should retry; do not mark `anchor_status=failed`.
 */
export class ProvenanceNotReadyError extends Error {
  readonly retryable = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceNotReadyError';
  }
}

export function isProvenanceNotReadyError(
  error: unknown,
): error is ProvenanceNotReadyError {
  return error instanceof ProvenanceNotReadyError;
}
