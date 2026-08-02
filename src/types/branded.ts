/**
 * Branded identifier types.
 *
 * These prevent accidentally passing, say, a `DeviceId` where a `WalletId` is
 * expected — both are strings at runtime, but the compiler keeps them distinct.
 * Construct them at trusted boundaries (after schema validation) via the
 * provided smart constructors.
 */

declare const brand: unique symbol;

export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type WalletId = Brand<string, 'WalletId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type TelemetryRecordId = Brand<string, 'TelemetryRecordId'>;

/**
 * A blockchain transaction hash/reference. Kept distinct from telemetry content
 * hashes so a payment tx and a content hash can never be silently swapped.
 */
export type TransactionRef = Brand<string, 'TransactionRef'>;

/** A content-addressed hash of a telemetry payload (provenance commitment). */
export type ContentHash = Brand<string, 'ContentHash'>;

export const toWalletId = (value: string): WalletId => value as WalletId;
export const toDeviceId = (value: string): DeviceId => value as DeviceId;
export const toTelemetryRecordId = (value: string): TelemetryRecordId =>
  value as TelemetryRecordId;
export const toTransactionRef = (value: string): TransactionRef =>
  value as TransactionRef;
export const toContentHash = (value: string): ContentHash =>
  value as ContentHash;
