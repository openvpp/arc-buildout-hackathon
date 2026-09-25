import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

/** Dashboard user identity. Registration/login is Circle DCW (email-keyed). */
export const principals = pgTable(
  'principals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: text('type').notNull().default('dashboard_user'),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('active'),
    ...timestamps,
  },
  (table) => [
    check('principals_type_check', sql`${table.type} in ('dashboard_user')`),
    check(
      'principals_status_check',
      sql`${table.status} in ('active', 'disabled')`,
    ),
    uniqueIndex('principals_type_display_name_uidx').on(
      table.type,
      table.displayName,
    ),
  ],
);

/** A Circle developer-controlled wallet, created server-side on registration. */
export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    address: text('address').notNull(),
    normalizedAddress: text('normalized_address').notNull(),
    walletType: text('wallet_type').notNull().default('circle'),
    circleWalletId: text('circle_wallet_id'),
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
    uniqueIndex('wallets_circle_wallet_id_uidx').on(table.circleWalletId),
    index('wallets_status_idx').on(table.status),
  ],
);

/** Ownership: which principal owns which wallet. */
export const principalWallets = pgTable(
  'principal_wallets',
  {
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.principalId, table.walletId] }),
    check(
      'principal_wallets_role_check',
      sql`${table.role} in ('owner', 'viewer')`,
    ),
    index('principal_wallets_wallet_idx').on(table.walletId),
  ],
);

/** In-flight Enode Link onboarding wizard state. */
export const pendingDeviceConnections = pgTable(
  'pending_device_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    walletAddress: text('wallet_address').notNull(),
    normalizedWalletAddress: text('normalized_wallet_address').notNull(),
    brand: text('brand').notNull(),
    normalizedBrand: text('normalized_brand').notNull(),
    provider: text('provider').notNull().default('enode'),
    providerUserId: text('provider_user_id'),
    providerDeviceId: text('provider_device_id'),
    providerData: jsonb('provider_data').$type<Record<string, unknown>>(),
    linkUrl: text('link_url'),
    status: text('status').notNull().default('pending_oauth'),
    requestMetadata: jsonb('request_metadata').$type<Record<string, unknown>>(),
    formData: jsonb('form_data').$type<Record<string, unknown>>(),
    resultDeviceId: uuid('result_device_id'),
    error: jsonb('error').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'pending_device_connections_status_check',
      sql`${table.status} in ('pending_oauth', 'oauth_completed', 'pending_form', 'completed', 'failed', 'expired', 'cancelled')`,
    ),
    index('pending_device_connections_wallet_idx').on(table.walletId),
    index('pending_device_connections_status_idx').on(table.status),
  ],
);

/** A connected Enode user/vendor session, one per wallet + external user id. */
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

/** A linked EV, its mint state, and its last known location for the globe. */
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
    provider: text('provider').notNull().default('enode'),
    externalDeviceId: text('external_device_id').notNull(),
    deviceType: text('device_type').notNull().default('vehicle'),
    vendor: text('vendor'),
    model: text('model'),
    displayName: text('display_name'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    nftTokenId: text('nft_token_id'),
    nftContractAddress: text('nft_contract_address'),
    nftTransactionHash: text('nft_transaction_hash'),
    nftMetadataUri: text('nft_metadata_uri'),
    network: text('network'),
    // 'unminted' -> 'pending' (claimed) -> 'minted' | 'failed'. mintClaimedAt
    // bounds a stale claim so a crashed worker's reservation can be reclaimed.
    mintStatus: text('mint_status').notNull().default('unminted'),
    mintClaimedAt: timestamp('mint_claimed_at', { withTimezone: true }),
    lastLatitude: numeric('last_latitude', { precision: 9, scale: 6 }),
    lastLongitude: numeric('last_longitude', { precision: 9, scale: 6 }),
    lastLocationAt: timestamp('last_location_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'devices_status_check',
      sql`${table.status} in ('active', 'inactive', 'disconnected')`,
    ),
    check(
      'devices_mint_status_check',
      sql`${table.mintStatus} in ('unminted', 'pending', 'minted', 'failed')`,
    ),
    uniqueIndex('devices_provider_external_device_uidx').on(
      table.provider,
      table.externalDeviceId,
    ),
    index('devices_wallet_idx').on(table.walletId),
    index('devices_wallet_status_idx').on(table.walletId, table.status),
  ],
);

/** Dedup for Enode webhook deliveries. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull().default('enode'),
    deliveryId: text('delivery_id').notNull(),
    rawBody: text('raw_body').notNull(),
    status: text('status').notNull().default('received'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'webhook_deliveries_status_check',
      sql`${table.status} in ('received', 'processed', 'failed')`,
    ),
    uniqueIndex('webhook_deliveries_provider_delivery_uidx').on(
      table.provider,
      table.deliveryId,
    ),
  ],
);

/** Crash-safe async job queue (currently: MINT_DEVICE_NFT). */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: bigint('attempts', { mode: 'number' }).notNull().default(0),
    lastError: text('last_error'),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'outbox_events_status_check',
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed')`,
    ),
    index('outbox_events_status_available_idx').on(
      table.status,
      table.availableAt,
    ),
  ],
);

export const schemaMeta = {
  tables: [
    'principals',
    'wallets',
    'principal_wallets',
    'pending_device_connections',
    'enode_connections',
    'devices',
    'webhook_deliveries',
    'outbox_events',
  ],
} as const;
