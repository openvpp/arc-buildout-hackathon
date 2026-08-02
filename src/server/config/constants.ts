/** Shared server-side constants that are not environment-dependent. */

export const PAYMENT_PROTOCOL_HEADER = 'X-Payment-Protocol-Version' as const;

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

export const REQUEST_ID_HEADER = 'X-Request-Id' as const;

export const API_KEY_HEADER = 'X-Api-Key' as const;

/** Circle x402 headers (lowercase per fetch Headers normalization). */
export const PAYMENT_REQUIRED_HEADER = 'payment-required' as const;
export const PAYMENT_SIGNATURE_HEADER = 'payment-signature' as const;
export const PAYMENT_RESPONSE_HEADER = 'payment-response' as const;

export const MAX_PAGE_SIZE = 100;

export const DEFAULT_PAGE_SIZE = 25;

/** Content-hash algorithm used for telemetry canonicalization (Phase 1 default). */
export const TELEMETRY_HASH_ALGORITHM = 'SHA-256' as const;

/** Canonicalization schema version for provenance-covered telemetry fields. */
export const TELEMETRY_CANONICALIZATION_VERSION = '1.0.0' as const;

export const TELEMETRY_SCHEMA_VERSION = '1.0.0' as const;

export const OUTBOX_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'dead_letter',
] as const;

export const OUTBOX_EVENT_TYPES = [
  'PROCESS_ENODE_WEBHOOK',
  'VERIFY_ARC_PAYMENT',
  'ANCHOR_TELEMETRY',
  'CHECK_ANCHOR_CONFIRMATIONS',
  'RECONCILE_PAYMENT',
  'RECONCILE_DEVICE',
] as const;

export const PRINCIPAL_TYPES = [
  'dashboard_user',
  'autonomous_agent',
  'service',
  'admin',
] as const;

export const API_SCOPES = [
  'telemetry:request',
  'payment:submit',
  'wallets:read',
  'devices:read',
  'telemetry:read',
  'admin:manage',
] as const;

export const PAYMENT_REQUIREMENT_STATUSES = [
  'pending',
  'submitted',
  'verifying',
  'confirmed',
  'failed',
  'expired',
  'cancelled',
  'consumed',
] as const;

export const ANCHOR_STATUSES = [
  'unanchored',
  'pending',
  'submitted',
  'anchored',
  'failed',
] as const;
