/**
 * Domain-facing repository and adapter interfaces.
 * Infrastructure implements these; application use cases depend on them.
 */

export type PrincipalRecord = {
  readonly id: string;
  readonly type: string;
  readonly displayName: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type WalletRecord = {
  readonly id: string;
  readonly chainId: bigint;
  readonly address: string;
  readonly normalizedAddress: string;
  readonly walletType: string;
  readonly label: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type DeviceRecord = {
  readonly id: string;
  readonly walletId: string;
  readonly enodeConnectionId: string | null;
  readonly externalDeviceId: string;
  readonly deviceType: string;
  readonly vendor: string | null;
  readonly model: string | null;
  readonly displayName: string | null;
  readonly status: string;
  readonly nftTokenId: string | null;
  readonly nftContractAddress: string | null;
  readonly nftTransactionHash: string | null;
  readonly nftMetadataUri: string | null;
  readonly network: string | null;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type OutboxEventRecord = {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly status: string;
  readonly attemptCount: number;
  readonly availableAt: Date;
  readonly lockedAt: Date | null;
  readonly lockedBy: string | null;
  readonly processedAt: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
};

export type PrincipalRepository = {
  create(input: {
    type: string;
    displayName: string;
  }): Promise<PrincipalRecord>;
  findById(id: string): Promise<PrincipalRecord | null>;
};

export type WalletRepository = {
  create(input: {
    chainId: bigint;
    address: string;
    normalizedAddress: string;
    label?: string;
  }): Promise<WalletRecord>;
  findById(id: string): Promise<WalletRecord | null>;
  findByChainAndNormalizedAddress(
    chainId: bigint,
    normalizedAddress: string,
  ): Promise<WalletRecord | null>;
  listByPrincipal(principalId: string): Promise<WalletRecord[]>;
};

export type DeviceRepository = {
  create(input: {
    walletId: string;
    externalDeviceId: string;
    deviceType?: string;
    vendor?: string;
    model?: string;
    displayName?: string;
    enodeConnectionId?: string;
  }): Promise<DeviceRecord>;
  findById(id: string): Promise<DeviceRecord | null>;
  listByWallet(walletId: string): Promise<DeviceRecord[]>;
};

export type OutboxRepository = {
  enqueue(input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    availableAt?: Date;
  }): Promise<OutboxEventRecord>;
  claimNext(input: {
    workerId: string;
    limit: number;
    lockDurationMs: number;
  }): Promise<OutboxEventRecord[]>;
  markCompleted(id: string): Promise<void>;
  markFailed(input: {
    id: string;
    error: string;
    retryAt: Date | null;
    deadLetter: boolean;
  }): Promise<void>;
};

/**
 * Payment verification port — retired for the Circle Gateway vertical slice.
 * Settlement is terminal via Circle facilitator; do not add a second Arc
 * payment-verification rail without an explicit product decision.
 */

/**
 * Provenance port — DeviceNFT `recordDeviceEvent` submit/confirm via worker.
 */
export type ProvenanceAnchor = {
  anchorTelemetry(input: {
    contentHash: string;
    telemetryRecordId: string;
    /** DeviceNFT token id required for live DeviceNFT provenance. */
    tokenId: string;
  }): Promise<{ status: 'submitted'; transactionHash: string }>;
  getAnchorStatus(input: { contentHash: string }): Promise<{
    status: 'pending' | 'anchored' | 'failed';
    transactionHash?: string;
  }>;
  verifyAnchor(input: {
    contentHash: string;
    anchorTransactionHash: string;
  }): Promise<{ valid: boolean; reason?: string }>;
};

/**
 * DeviceNFT mint port — Arc registry of linked EVs.
 *
 * `onBroadcast` is invoked with the transaction hash the instant it is broadcast
 * (before confirmation) so the caller can persist it for crash-safe idempotency;
 * `reconcileMint` adopts an already-broadcast tx instead of minting again.
 */
export type DeviceNftMinter = {
  mintDevice(input: {
    to: string;
    typeId: bigint;
    deviceURI: string;
    onBroadcast?: (transactionHash: string) => void | Promise<void>;
  }): Promise<{ tokenId: string; transactionHash: string }>;
  reconcileMint(input: {
    transactionHash: string;
    to: string;
    typeId: bigint;
  }): Promise<{ tokenId: string } | null>;
};

/**
 * Enode HTTP access is implemented by `createHttpEnodeVehicleClient`.
 * A broad EnodeClient port is intentionally not registered on the container.
 */

export type TelemetryPricingPolicy = {
  getPrice(input: { deviceId: string; telemetryRecordId: string }): Promise<{
    amountAtomic: string;
    amountDisplay: string;
    decimals: number;
    asset: string;
    pricingVersion: string;
  }>;
};
