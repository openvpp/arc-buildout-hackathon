import type {
  ContentHash,
  DeviceId,
  TelemetryRecordId,
  TransactionRef,
  WalletId,
} from '@/types/branded';

/**
 * ============================================================================
 * PROVISIONAL DOMAIN MODELS — Phase 1
 * ============================================================================
 *
 * These shapes describe the INTENDED contract with the future backend. They are
 * NOT final. Field names and structures are subject to change and will be
 * replaced by backend-generated types (e.g. an OpenAPI-derived client) in a
 * later phase. Treat every field here as provisional.
 *
 * The frontend is never the source of truth for payments, telemetry freshness,
 * or blockchain verification. These types model DISPLAY data plus independent
 * verification evidence — not authorization.
 * ============================================================================
 */

/** A wallet that can hold a seller balance and own one or more devices. */
export type Wallet = {
  readonly id: WalletId;
  /** Human-facing label. */
  readonly label: string;
  /** On-chain address. Untrusted until validated; display-only in Phase 1. */
  readonly address: string;
  /** Number of devices associated with this wallet. */
  readonly deviceCount: number;
};

/** An EV device that emits telemetry. Belongs to exactly one wallet. */
export type Device = {
  readonly id: DeviceId;
  readonly walletId: WalletId;
  readonly label: string;
  readonly vendor?: string;
  readonly model?: string;
};

/**
 * The latest telemetry record for a device. Only the LATEST record is ever
 * sold, per the product model. Payload is intentionally opaque in Phase 1.
 */
export type TelemetryRecord = {
  readonly id: TelemetryRecordId;
  readonly walletId: WalletId;
  readonly deviceId: DeviceId;
  /** When the device produced the reading (ISO-8601). */
  readonly recordedAt: string;
  /** Content-addressed hash committed on-chain for provenance. */
  readonly contentHash: ContentHash;
};

/**
 * The `402 Payment Required` payload: instructions for the USDC nanopayment the
 * autonomous agent must send. The dashboard NEVER executes this payment.
 */
export type PaymentRequirement = {
  /** Correlates the requirement with the eventual payment/telemetry response. */
  readonly requestId: string;
  /** Amount in the token's smallest unit, as a string to avoid float loss. */
  readonly amount: string;
  readonly currency: 'USDC';
  /** Destination seller wallet address. */
  readonly sellerAddress: string;
  /** Chain identifier the payment must be made on (e.g. Arc testnet). */
  readonly chain: string;
  /** ISO-8601 expiry after which the requirement is stale. */
  readonly expiresAt: string;
};

/** Proof-of-payment reference. Proves PAYMENT, not provenance. */
export type PaymentReference = {
  readonly paymentTransactionRef: TransactionRef;
  readonly paidAt: string;
};

/**
 * Provenance/anchor reference. Proves the telemetry CONTENT COMMITMENT, not
 * payment. This is a DIFFERENT transaction from the payment reference and must
 * never be conflated with it.
 */
export type ProvenanceReference = {
  readonly anchorTransactionRef: TransactionRef;
  readonly contentHash: ContentHash;
  readonly anchoredAt: string;
};

/** Explicit verification lifecycle — never a vague optional boolean. */
export type VerificationStatus =
  'not_started' | 'verifying' | 'verified' | 'failed';

/**
 * Result of the agent's INDEPENDENT verification (anchor exists on Arc testnet
 * AND returned content hash matches the anchored hash). Modeled as a
 * discriminated union so impossible states are unrepresentable.
 */
export type VerificationResult =
  | { readonly status: 'not_started' }
  | { readonly status: 'verifying'; readonly startedAt: string }
  | {
      readonly status: 'verified';
      readonly verifiedAt: string;
      readonly anchorExists: true;
      readonly contentHashMatches: true;
    }
  | {
      readonly status: 'failed';
      readonly failedAt: string;
      readonly reason: string;
      readonly anchorExists: boolean;
      readonly contentHashMatches: boolean;
    };

/**
 * Composed, display-oriented view of a telemetry record together with its
 * payment, provenance, and verification evidence. This is the UI view model the
 * dashboard renders per wallet + device. Assembled by the backend response and
 * validated at the boundary before reaching UI code.
 */
export type TelemetryVerificationView = {
  readonly walletId: WalletId;
  readonly deviceId: DeviceId;
  readonly telemetryRecordId: TelemetryRecordId;
  /** When the device produced the reading. */
  readonly telemetryTimestamp: string;
  /** When the dashboard/agent retrieved it. */
  readonly retrievalTimestamp: string;
  readonly contentHash: ContentHash;
  readonly payment: PaymentReference;
  readonly provenance: ProvenanceReference;
  readonly verification: VerificationResult;
};
