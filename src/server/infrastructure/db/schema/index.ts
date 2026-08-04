import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Production schema for the EV telemetry nanopayment backend.
 *
 * Design notes:
 * - Constrained `text` columns are preferred over PostgreSQL enums so status
 *   vocabularies can evolve without painful enum migrations. Check constraints
 *   still enforce allowed values.
 * - Monetary amounts use `numeric(78, 0)` (atomic integer units as decimal) to
 *   avoid JavaScript Number precision loss while remaining portable.
 * - Payment and provenance transaction hashes are separate columns/concepts.
 * - Anchored telemetry records must not be mutated; corrections create new rows.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const principals = pgTable(
  'principals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    check(
      'principals_type_check',
      sql`${table.type} in ('dashboard_user', 'autonomous_agent', 'service', 'admin')`,
    ),
    check(
      'principals_status_check',
      sql`${table.status} in ('active', 'suspended', 'deleted')`,
    ),
    index('principals_type_status_idx').on(table.type, table.status),
  ],
);

export const apiCredentials = pgTable(
  'api_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'api_credentials_status_check',
      sql`${table.status} in ('active', 'revoked', 'expired')`,
    ),
    uniqueIndex('api_credentials_key_hash_uidx').on(table.keyHash),
    index('api_credentials_principal_idx').on(table.principalId),
    index('api_credentials_prefix_idx').on(table.keyPrefix),
  ],
);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    address: text('address').notNull(),
    normalizedAddress: text('normalized_address').notNull(),
    walletType: text('wallet_type').notNull().default('evm'),
    label: text('label'),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    check(
      'wallets_status_check',
      sql`${table.status} in ('active', 'disabled')`,
    ),
    uniqueIndex('wallets_chain_normalized_address_uidx').on(
      table.chainId,
      table.normalizedAddress,
    ),
    index('wallets_status_idx').on(table.status),
  ],
);

export const principalWallets = pgTable(
  'principal_wallets',
  {
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.walletId] }),
    check(
      'principal_wallets_role_check',
      sql`${table.role} in ('owner', 'agent', 'viewer', 'admin')`,
    ),
    index('principal_wallets_wallet_idx').on(table.walletId),
  ],
);

export const enodeConnections = pgTable(
  'enode_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalUserId: text('external_user_id').notNull(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('connected'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'enode_connections_status_check',
      sql`${table.status} in ('connected', 'disconnected', 'error')`,
    ),
    uniqueIndex('enode_connections_external_user_uidx').on(
      table.externalUserId,
    ),
    index('enode_connections_wallet_idx').on(table.walletId),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    enodeConnectionId: uuid('enode_connection_id').references(
      () => enodeConnections.id,
      { onDelete: 'set null' },
    ),
    externalDeviceId: text('external_device_id').notNull(),
    deviceType: text('device_type').notNull().default('vehicle'),
    vendor: text('vendor'),
    model: text('model'),
    displayName: text('display_name'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'devices_status_check',
      sql`${table.status} in ('active', 'inactive', 'disconnected')`,
    ),
    uniqueIndex('devices_external_device_uidx').on(table.externalDeviceId),
    index('devices_wallet_idx').on(table.walletId),
    index('devices_wallet_status_idx').on(table.walletId, table.status),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id'),
    dedupeKey: text('dedupe_key').notNull(),
    eventType: text('event_type').notNull(),
    signature: text('signature'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processingStatus: text('processing_status').notNull().default('received'),
    attemptCount: integer('attempt_count').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'webhook_deliveries_status_check',
      sql`${table.processingStatus} in ('received', 'queued', 'processing', 'processed', 'unsupported', 'failed', 'dead_letter')`,
    ),
    uniqueIndex('webhook_deliveries_dedupe_uidx').on(
      table.provider,
      table.dedupeKey,
    ),
    uniqueIndex('webhook_deliveries_provider_event_uidx')
      .on(table.provider, table.providerEventId)
      .where(sql`${table.providerEventId} is not null`),
    index('webhook_deliveries_status_idx').on(table.processingStatus),
  ],
);

export const telemetryRecords = pgTable(
  'telemetry_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    source: text('source').notNull(),
    sourceEventId: text('source_event_id'),
    sourceObservedAt: timestamp('source_observed_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    sequenceNumber: bigint('sequence_number', { mode: 'bigint' }),
    schemaVersion: text('schema_version').notNull(),
    telemetryPayload: jsonb('telemetry_payload')
      .$type<Record<string, unknown>>()
      .notNull(),
    canonicalPayload: jsonb('canonical_payload')
      .$type<Record<string, unknown>>()
      .notNull(),
    canonicalizationVersion: text('canonicalization_version').notNull(),
    contentHashAlgorithm: text('content_hash_algorithm').notNull(),
    contentHash: text('content_hash').notNull(),
    anchorStatus: text('anchor_status').notNull().default('unanchored'),
    anchorTransactionHash: text('anchor_transaction_hash'),
    anchorBlockNumber: bigint('anchor_block_number', { mode: 'bigint' }),
    anchorBlockHash: text('anchor_block_hash'),
    anchoredAt: timestamp('anchored_at', { withTimezone: true }),
    dataOrigin: text('data_origin').notNull().default('ENODE_SANDBOX'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'telemetry_records_anchor_status_check',
      sql`${table.anchorStatus} in ('unanchored', 'pending', 'submitted', 'anchored', 'failed')`,
    ),
    check(
      'telemetry_records_data_origin_check',
      sql`${table.dataOrigin} in ('ENODE_SANDBOX', 'ENODE_PRODUCTION')`,
    ),
    uniqueIndex('telemetry_records_content_hash_uidx').on(table.contentHash),
    uniqueIndex('telemetry_records_source_event_uidx')
      .on(table.source, table.sourceEventId)
      .where(sql`${table.sourceEventId} is not null`),
    index('telemetry_records_latest_by_device_idx').on(
      table.deviceId,
      table.recordedAt.desc(),
      table.id.desc(),
    ),
    index('telemetry_records_unanchored_idx')
      .on(table.anchorStatus, table.createdAt)
      .where(
        sql`${table.anchorStatus} in ('unanchored', 'pending', 'submitted')`,
      ),
    index('telemetry_records_device_recorded_idx').on(
      table.deviceId,
      table.recordedAt,
    ),
  ],
);

export const agentDeviceCursors = pgTable(
  'agent_device_cursors',
  {
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    lastDeliveredRecordId: uuid('last_delivered_record_id').references(
      () => telemetryRecords.id,
      { onDelete: 'set null' },
    ),
    lastDeliveredAt: timestamp('last_delivered_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.deviceId] }),
    index('agent_device_cursors_device_idx').on(table.deviceId),
  ],
);

export const paymentRequirements = pgTable(
  'payment_requirements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'restrict' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    telemetryRecordId: uuid('telemetry_record_id')
      .notNull()
      .references(() => telemetryRecords.id, { onDelete: 'restrict' }),
    pricingVersion: text('pricing_version').notNull(),
    network: text('network').notNull(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    asset: text('asset').notNull().default('USDC'),
    tokenContractAddress: text('token_contract_address').notNull(),
    amountAtomic: numeric('amount_atomic', {
      precision: 78,
      scale: 0,
    }).notNull(),
    amountDisplay: text('amount_display').notNull(),
    decimals: integer('decimals').notNull().default(6),
    sellerWalletAddress: text('seller_wallet_address').notNull(),
    payerWalletAddress: text('payer_wallet_address'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      'payment_requirements_status_check',
      sql`${table.status} in ('pending', 'submitted', 'verifying', 'confirmed', 'failed', 'expired', 'cancelled', 'consumed')`,
    ),
    check('payment_requirements_decimals_check', sql`${table.decimals} >= 0`),
    // One active requirement per principal + telemetry + pricing version.
    uniqueIndex('payment_requirements_active_uidx')
      .on(table.principalId, table.telemetryRecordId, table.pricingVersion)
      .where(
        sql`${table.status} in ('pending', 'submitted', 'verifying', 'confirmed')`,
      ),
    index('payment_requirements_status_expires_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('payment_requirements_principal_idx').on(table.principalId),
    index('payment_requirements_telemetry_idx').on(table.telemetryRecordId),
  ],
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentRequirementId: uuid('payment_requirement_id')
      .notNull()
      .references(() => paymentRequirements.id, { onDelete: 'restrict' }),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    transactionHash: text('transaction_hash').notNull(),
    blockHash: text('block_hash'),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    transactionIndex: integer('transaction_index'),
    fromAddress: text('from_address'),
    toAddress: text('to_address'),
    tokenContractAddress: text('token_contract_address'),
    amountAtomic: numeric('amount_atomic', { precision: 78, scale: 0 }),
    confirmationCount: integer('confirmation_count').notNull().default(0),
    verificationStatus: text('verification_status')
      .notNull()
      .default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    failureDetails: jsonb('failure_details').$type<Record<string, unknown>>(),
    rawReceipt: jsonb('raw_receipt').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    check(
      'payment_transactions_verification_status_check',
      sql`${table.verificationStatus} in ('pending', 'verifying', 'confirmed', 'failed', 'reorged')`,
    ),
    uniqueIndex('payment_transactions_chain_hash_uidx').on(
      table.chainId,
      table.transactionHash,
    ),
    uniqueIndex('payment_transactions_requirement_uidx').on(
      table.paymentRequirementId,
    ),
    index('payment_transactions_status_idx').on(table.verificationStatus),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'restrict' }),
    walletId: uuid('wallet_id').references(() => wallets.id, {
      onDelete: 'restrict',
    }),
    paymentRequirementId: uuid('payment_requirement_id').references(
      () => paymentRequirements.id,
      { onDelete: 'restrict' },
    ),
    paymentTransactionId: uuid('payment_transaction_id').references(
      () => paymentTransactions.id,
      { onDelete: 'restrict' },
    ),
    entryType: text('entry_type').notNull(),
    amountAtomic: numeric('amount_atomic', {
      precision: 78,
      scale: 0,
    }).notNull(),
    asset: text('asset').notNull(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'ledger_entries_type_check',
      sql`${table.entryType} in ('payment_credit', 'telemetry_charge', 'refund_credit', 'adjustment_debit', 'adjustment_credit')`,
    ),
    uniqueIndex('ledger_entries_idempotency_uidx').on(table.idempotencyKey),
    index('ledger_entries_principal_created_idx').on(
      table.principalId,
      table.createdAt,
    ),
  ],
);

export const telemetryDeliveries = pgTable(
  'telemetry_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    telemetryRecordId: uuid('telemetry_record_id')
      .notNull()
      .references(() => telemetryRecords.id, { onDelete: 'restrict' }),
    paymentRequirementId: uuid('payment_requirement_id')
      .notNull()
      .references(() => paymentRequirements.id, { onDelete: 'restrict' }),
    paymentTransactionId: uuid('payment_transaction_id').references(
      () => paymentTransactions.id,
      { onDelete: 'restrict' },
    ),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull(),
    deliveryStatus: text('delivery_status').notNull().default('delivered'),
    responseHash: text('response_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'telemetry_deliveries_status_check',
      sql`${table.deliveryStatus} in ('delivered', 'replayed')`,
    ),
    uniqueIndex('telemetry_deliveries_purchase_uidx').on(
      table.principalId,
      table.telemetryRecordId,
      table.paymentRequirementId,
    ),
    index('telemetry_deliveries_device_idx').on(
      table.deviceId,
      table.deliveredAt,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    requestMethod: text('request_method').notNull(),
    requestPath: text('request_path').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('processing'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      'idempotency_records_status_check',
      sql`${table.status} in ('processing', 'completed', 'failed')`,
    ),
    uniqueIndex('idempotency_records_principal_key_uidx').on(
      table.principalId,
      table.idempotencyKey,
    ),
    index('idempotency_records_expires_idx').on(table.expiresAt),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'outbox_events_status_check',
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed', 'dead_letter')`,
    ),
    index('outbox_events_claim_idx')
      .on(table.status, table.availableAt)
      .where(sql`${table.status} in ('pending', 'failed')`),
    index('outbox_events_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
    ),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    requestId: text('request_id'),
    principalId: uuid('principal_id').references(() => principals.id, {
      onDelete: 'set null',
    }),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    result: text('result').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_logs_principal_created_idx').on(
      table.principalId,
      table.createdAt,
    ),
    index('audit_logs_action_created_idx').on(table.action, table.createdAt),
    index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
  ],
);

export const anchorBatches = pgTable(
  'anchor_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    contractAddress: text('contract_address').notNull(),
    contractVersion: text('contract_version').notNull(),
    batchRoot: text('batch_root').notNull(),
    status: text('status').notNull().default('pending'),
    anchorTransactionHash: text('anchor_transaction_hash'),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    blockHash: text('block_hash'),
    logIndex: integer('log_index'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'anchor_batches_status_check',
      sql`${table.status} in ('pending', 'submitted', 'confirmed', 'failed')`,
    ),
    uniqueIndex('anchor_batches_tx_uidx')
      .on(table.chainId, table.anchorTransactionHash)
      .where(sql`${table.anchorTransactionHash} is not null`),
    index('anchor_batches_status_idx').on(table.status),
  ],
);

export const anchorBatchRecords = pgTable(
  'anchor_batch_records',
  {
    batchId: uuid('batch_id')
      .notNull()
      .references(() => anchorBatches.id, { onDelete: 'cascade' }),
    telemetryRecordId: uuid('telemetry_record_id')
      .notNull()
      .references(() => telemetryRecords.id, { onDelete: 'restrict' }),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.telemetryRecordId] }),
    uniqueIndex('anchor_batch_records_telemetry_uidx').on(
      table.telemetryRecordId,
    ),
  ],
);

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bucketKey: text('bucket_key').notNull(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
    }).notNull(),
    windowSeconds: integer('window_seconds').notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('rate_limit_buckets_key_window_uidx').on(
      table.bucketKey,
      table.windowStartedAt,
    ),
    index('rate_limit_buckets_updated_idx').on(table.updatedAt),
  ],
);

/**
 * Agent-side independent verification of settlement tx + content hash.
 * Dashboard displays this evidence; it is not authorization to release data.
 */
export const agentVerificationResults = pgTable(
  'agent_verification_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    telemetryRecordId: uuid('telemetry_record_id')
      .notNull()
      .references(() => telemetryRecords.id, { onDelete: 'cascade' }),
    paymentTransactionHash: text('payment_transaction_hash').notNull(),
    status: text('status').notNull(),
    receiptFound: boolean('receipt_found').notNull().default(false),
    receiptSuccess: boolean('receipt_success').notNull().default(false),
    contentHashExpected: text('content_hash_expected').notNull(),
    contentHashComputed: text('content_hash_computed').notNull(),
    contentHashMatched: boolean('content_hash_matched')
      .notNull()
      .default(false),
    details: jsonb('details').$type<Record<string, unknown>>(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'agent_verification_results_status_check',
      sql`${table.status} in ('VERIFIED', 'TX_MISSING', 'TX_FAILED', 'HASH_MISMATCH', 'ERROR')`,
    ),
    uniqueIndex('agent_verification_results_unique_uidx').on(
      table.principalId,
      table.telemetryRecordId,
      table.paymentTransactionHash,
    ),
    index('agent_verification_results_telemetry_idx').on(
      table.telemetryRecordId,
    ),
  ],
);

/**
 * Cached Enode client-credentials access token (app-scoped, not per user).
 */
export const enodeApiTokens = pgTable(
  'enode_api_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenKey: text('token_key').notNull(),
    accessToken: text('access_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('enode_api_tokens_key_uidx').on(table.tokenKey)],
);

/**
 * Enode Link wizard state: pending_oauth → pending_form → completed.
 * Temporary walletAddress identity until Web3Auth lands.
 */
export const pendingDeviceConnections = pgTable(
  'pending_device_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    normalizedWalletAddress: text('normalized_wallet_address').notNull(),
    walletId: uuid('wallet_id').references(() => wallets.id, {
      onDelete: 'set null',
    }),
    environment: text('environment').notNull().default('production'),
    deviceType: text('device_type').notNull().default('electric_vehicle'),
    brand: text('brand').notNull(),
    normalizedBrand: text('normalized_brand').notNull(),
    provider: text('provider').notNull().default('enode'),
    providerVendorId: text('provider_vendor_id'),
    status: text('status').notNull().default('pending_oauth'),
    linkUrl: text('link_url'),
    providerConnectionId: text('provider_connection_id'),
    providerDeviceId: text('provider_device_id'),
    providerUserId: text('provider_user_id'),
    providerData: jsonb('provider_data').$type<Record<string, unknown>>(),
    formData: jsonb('form_data').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    requestMetadata: jsonb('request_metadata').$type<Record<string, unknown>>(),
    resultDeviceId: uuid('result_device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'pending_device_connections_status_check',
      sql`${table.status} in ('pending_oauth', 'oauth_completed', 'pending_form', 'completed', 'failed', 'expired', 'cancelled')`,
    ),
    check(
      'pending_device_connections_provider_check',
      sql`${table.provider} in ('enode')`,
    ),
    index('pending_device_connections_wallet_status_idx').on(
      table.normalizedWalletAddress,
      table.status,
    ),
    index('pending_device_connections_provider_device_idx').on(
      table.provider,
      table.providerDeviceId,
    ),
    index('pending_device_connections_expires_idx').on(table.expiresAt),
  ],
);

/** Convenience boolean helpers for schema consumers (not persisted). */
export const schemaMeta = {
  usesFloatingPointForTokens: false as const,
  separatesPaymentAndAnchorHashes: true as const,
};
