import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
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

/** Dashboard user identity. One row per email, whether the person signed in with a password or Google. */
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

/**
 * Password for a dashboard principal. The email is the lookup key; the
 * hash is the proof. A row is created only by password registration, never
 * by attaching a password to an existing Google-only principal.
 */
export const dashboardPasswordCredentials = pgTable(
  'dashboard_password_credentials',
  {
    principalId: uuid('principal_id')
      .primaryKey()
      .references(() => principals.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('dashboard_password_credentials_email_uidx').on(table.email),
    check(
      'dashboard_password_credentials_email_check',
      sql`${table.email} = lower(${table.email}) and char_length(${table.email}) between 3 and 320 and position('@' in ${table.email}) > 1`,
    ),
    check(
      'dashboard_password_credentials_hash_check',
      sql`char_length(${table.passwordHash}) between 20 and 500`,
    ),
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
    // Matches the on-chain device-class taxonomy — see device-types.ts.
    // Only 'electric_vehicle' is onboarded by this app today; the rest are
    // reserved to mirror the deployed contract's typeId space.
    deviceType: text('device_type').notNull().default('electric_vehicle'),
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
    // When this server saw the mint confirm. Events queued before it could
    // not be anchored earlier; verification measures their lateness from it.
    nftMintedAt: timestamp('nft_minted_at', { withTimezone: true }),
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
    check(
      'devices_device_type_check',
      sql`${table.deviceType} in ('electric_vehicle', 'charger', 'battery', 'solar', 'thermostat')`,
    ),
    uniqueIndex('devices_provider_external_device_uidx').on(
      table.provider,
      table.externalDeviceId,
    ),
    index('devices_wallet_idx').on(table.walletId),
    index('devices_wallet_status_idx').on(table.walletId, table.status),
    // Globe query: located devices, newest fix first. Partial so unlocated
    // rows (the common case right after link) stay out of the index.
    index('devices_located_sort_idx')
      .on(table.lastLocationAt, table.id)
      .where(
        sql`${table.lastLatitude} is not null and ${table.lastLongitude} is not null`,
      ),
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
    // Set when a worker claims the row. A `processing` row whose lock is
    // older than the worker lease is reclaimable after a crash.
    lockedAt: timestamp('locked_at', { withTimezone: true }),
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
    uniqueIndex('outbox_events_one_active_mint_uidx')
      .on(table.aggregateType, table.aggregateId, table.eventType)
      .where(sql`${table.status} in ('pending', 'processing')`),
  ],
);

/**
 * One charging session per plug-in, derived from Enode `chargeState`.
 * Everything here stays off-chain; only the whitelisted fields in the
 * device_events payload are published. Location never leaves this table.
 */
export const chargingSessions = pgTable(
  'charging_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    // Deterministic (`enode_<externalDeviceId>_<startMs>`) so a replayed
    // webhook can never open a second session for the same start.
    sessionId: text('session_id').notNull(),
    // 'active' -> 'completed' | 'cancelled'
    status: text('status').notNull().default('active'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }),
    startBatteryLevel: numeric('start_battery_level', {
      precision: 5,
      scale: 2,
    }),
    endBatteryLevel: numeric('end_battery_level', { precision: 5, scale: 2 }),
    batteryCapacityKwh: numeric('battery_capacity_kwh', {
      precision: 7,
      scale: 3,
    }),
    energyDeliveredKwh: numeric('energy_delivered_kwh', {
      precision: 10,
      scale: 4,
    })
      .notNull()
      .default('0'),
    // How energyDeliveredKwh was obtained. Published as `method` — never
    // label an estimate as 'direct_kwh'.
    energyMethod: text('energy_method').notNull().default('unknown'),
    electricityPrice: numeric('electricity_price', { precision: 10, scale: 4 }),
    totalCost: numeric('total_cost', { precision: 12, scale: 4 }),
    currency: text('currency').notNull().default('USD'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    lastProviderUpdateAt: timestamp('last_provider_update_at', {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    check(
      'charging_sessions_status_check',
      sql`${table.status} in ('active', 'completed', 'cancelled')`,
    ),
    check(
      'charging_sessions_energy_method_check',
      sql`${table.energyMethod} in ('direct_kwh', 'estimated_from_battery_change', 'unknown')`,
    ),
    check(
      'charging_sessions_battery_range_check',
      sql`(${table.startBatteryLevel} is null or ${table.startBatteryLevel} between 0 and 100) and (${table.endBatteryLevel} is null or ${table.endBatteryLevel} between 0 and 100)`,
    ),
    check(
      'charging_sessions_non_negative_check',
      sql`${table.energyDeliveredKwh} >= 0 and (${table.electricityPrice} is null or ${table.electricityPrice} >= 0) and (${table.totalCost} is null or ${table.totalCost} >= 0)`,
    ),
    check(
      'charging_sessions_end_after_start_check',
      sql`${table.endTime} is null or ${table.endTime} >= ${table.startTime}`,
    ),
    check(
      'charging_sessions_closed_has_end_check',
      sql`${table.status} = 'active' or ${table.endTime} is not null`,
    ),
    uniqueIndex('charging_sessions_session_id_uidx').on(table.sessionId),
    // At most one live session per device.
    uniqueIndex('charging_sessions_one_active_uidx')
      .on(table.deviceId)
      .where(sql`${table.status} = 'active'`),
    index('charging_sessions_device_start_idx').on(
      table.deviceId,
      table.startTime,
      table.id,
    ),
  ],
);

/** Raw odometer readings as reported by the provider (off-chain). */
export const odometerReadings = pgTable(
  'odometer_readings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    odometerKm: numeric('odometer_km', { precision: 12, scale: 3 }).notNull(),
    webhookDeliveryId: uuid('webhook_delivery_id').references(
      () => webhookDeliveries.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'odometer_readings_non_negative_check',
      sql`${table.odometerKm} >= 0`,
    ),
    uniqueIndex('odometer_readings_device_observed_uidx').on(
      table.deviceId,
      table.observedAt,
    ),
  ],
);

/**
 * Per-device, per-UTC-day odometer aggregate. Finalized once the day is over
 * and then published as one daily TRIP_COMPLETED event.
 */
export const dailyOdometer = pgTable(
  'daily_odometer',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    dateUtc: date('date_utc', { mode: 'string' }).notNull(),
    startOdometerKm: numeric('start_odometer_km', {
      precision: 12,
      scale: 3,
    }).notNull(),
    endOdometerKm: numeric('end_odometer_km', {
      precision: 12,
      scale: 3,
    }).notNull(),
    // True when the day's start is its own first reading. False when the
    // start is a prior day's end, including across silent days.
    startEstimated: boolean('start_estimated').notNull().default(false),
    readingCount: bigint('reading_count', { mode: 'number' })
      .notNull()
      .default(0),
    // Readings rejected as implausible (odometer going backwards, etc.).
    anomalyCount: bigint('anomaly_count', { mode: 'number' })
      .notNull()
      .default(0),
    lastReadingAt: timestamp('last_reading_at', { withTimezone: true }),
    // 'open' -> 'finalized'
    status: text('status').notNull().default('open'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'daily_odometer_status_check',
      sql`${table.status} in ('open', 'finalized')`,
    ),
    check(
      'daily_odometer_monotonic_check',
      sql`${table.startOdometerKm} >= 0 and ${table.endOdometerKm} >= ${table.startOdometerKm}`,
    ),
    check(
      'daily_odometer_finalized_at_check',
      sql`${table.status} = 'open' or ${table.finalizedAt} is not null`,
    ),
    uniqueIndex('daily_odometer_device_date_uidx').on(
      table.deviceId,
      table.dateUtc,
    ),
    // Finalization sweep: open days older than today.
    index('daily_odometer_open_date_idx')
      .on(table.dateUtc)
      .where(sql`${table.status} = 'open'`),
  ],
);

/**
 * The on-chain time series: one row per `recordDeviceEvent` call on the
 * DeviceNFT contract. `payloadJson` is the exact UTF-8 string sent as the
 * event's `data` bytes and is fixed at creation, so `payloadHash` lets anyone
 * match a DB row to the on-chain log. Not a mint — see devices.nft_*.
 *
 * 'queued' (waiting for the device's mint and a worker) -> 'pending'
 * (claimed; tx hash persisted before confirmation) -> 'confirmed' | 'failed'.
 */
export const deviceEvents = pgTable(
  'device_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'restrict' }),
    // On-chain eventType: 2 = CHARGING_COMPLETED, 12 = TRIP_COMPLETED.
    eventType: smallint('event_type').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    // When the recorded activity ended (session end / end of UTC day).
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payloadJson: text('payload_json').notNull(),
    payloadHash: text('payload_hash').notNull(),
    // 1 = public fields only; 2 = also carries `recordHash`, the salted
    // keccak256 of `record_json`, committing to the full off-chain record.
    payloadVersion: smallint('payload_version').notNull().default(1),
    // Off-chain only (contains location / raw readings). Never published.
    recordJson: text('record_json'),
    recordSalt: text('record_salt'),
    recordHash: text('record_hash'),
    // Latest independent verification (history in event_verifications).
    verificationStatus: text('verification_status')
      .notNull()
      .default('unchecked'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    // Verify-job retry state: consecutive failed check jobs and when the
    // sweep may queue the next one (null = due now). Reset on any verdict.
    verificationAttempts: smallint('verification_attempts')
      .notNull()
      .default(0),
    verificationNextCheckAt: timestamp('verification_next_check_at', {
      withTimezone: true,
    }),
    status: text('status').notNull().default('queued'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    chainId: bigint('chain_id', { mode: 'bigint' }),
    contractAddress: text('contract_address'),
    tokenId: text('token_id'),
    transactionHash: text('transaction_hash'),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check('device_events_event_type_check', sql`${table.eventType} in (2, 12)`),
    check(
      'device_events_source_type_check',
      sql`${table.sourceType} in ('charging_session', 'daily_odometer')`,
    ),
    check(
      'device_events_source_matches_type_check',
      sql`(${table.sourceType} = 'charging_session' and ${table.eventType} = 2) or (${table.sourceType} = 'daily_odometer' and ${table.eventType} = 12)`,
    ),
    check(
      'device_events_status_check',
      sql`${table.status} in ('queued', 'pending', 'confirmed', 'failed')`,
    ),
    check(
      'device_events_verification_attempts_check',
      sql`${table.verificationAttempts} >= 0`,
    ),
    check(
      'device_events_verification_status_check',
      sql`${table.verificationStatus} in ('unchecked', 'pending', 'verified', 'verified_with_warnings', 'unverified')`,
    ),
    check(
      'device_events_record_commitment_check',
      sql`(${table.payloadVersion} = 1 and ${table.recordHash} is null and ${table.recordSalt} is null and ${table.recordJson} is null) or (${table.payloadVersion} = 2 and ${table.recordHash} is not null and ${table.recordSalt} is not null and ${table.recordJson} is not null)`,
    ),
    check(
      'device_events_confirmed_has_tx_check',
      sql`${table.status} <> 'confirmed' or (${table.transactionHash} is not null and ${table.tokenId} is not null and ${table.confirmedAt} is not null)`,
    ),
    // Idempotency: a session/day is published at most once per event type.
    uniqueIndex('device_events_source_uidx').on(
      table.sourceType,
      table.sourceId,
      table.eventType,
    ),
    uniqueIndex('device_events_transaction_hash_uidx')
      .on(table.transactionHash)
      .where(sql`${table.transactionHash} is not null`),
    // Admin records list (all devices, newest first, optionally by verdict).
    index('device_events_confirmed_occurred_idx')
      .on(table.occurredAt, table.id)
      .where(sql`${table.status} = 'confirmed'`),
    index('device_events_confirmed_verdict_occurred_idx')
      .on(table.verificationStatus, table.occurredAt, table.id)
      .where(sql`${table.status} = 'confirmed'`),
    // Verification sweep: confirmed records still awaiting a verdict.
    index('device_events_verification_due_idx')
      .on(table.verificationNextCheckAt, table.confirmedAt)
      .where(
        sql`${table.status} = 'confirmed' and ${table.verificationStatus} in ('unchecked', 'pending')`,
      ),
    // Per-device timeline, newest first, keyset-paginated.
    index('device_events_device_occurred_idx').on(
      table.deviceId,
      table.occurredAt,
      table.id,
    ),
  ],
);

/**
 * The owner-entered address for a device (personal data). One per device.
 * The exact address and coordinates are owner-only; the public globe only
 * ever sees `public_latitude/longitude`, a stable point 0.5–2 km from the
 * real one. Nothing here is ever published on-chain.
 */
export const deviceAddresses = pgTable(
  'device_addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Cascade: the address goes when the device does.
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    formattedAddress: text('formatted_address').notNull(),
    unit: text('unit'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }).notNull(),
    longitude: numeric('longitude', { precision: 9, scale: 6 }).notNull(),
    publicLatitude: numeric('public_latitude', {
      precision: 9,
      scale: 6,
    }).notNull(),
    publicLongitude: numeric('public_longitude', {
      precision: 9,
      scale: 6,
    }).notNull(),
    geocoder: text('geocoder').notNull().default('mapbox'),
    geocoderPlaceId: text('geocoder_place_id'),
    // Whether the geocoder allowed storing this result (Mapbox permanent=true).
    geocodedPermanent: boolean('geocoded_permanent').notNull().default(false),
    updatedByPrincipalId: uuid('updated_by_principal_id').references(
      () => principals.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
  },
  (table) => [
    check(
      'device_addresses_coordinates_check',
      sql`${table.latitude} between -90 and 90 and ${table.longitude} between -180 and 180 and ${table.publicLatitude} between -90 and 90 and ${table.publicLongitude} between -180 and 180`,
    ),
    check(
      'device_addresses_country_code_check',
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'device_addresses_lengths_check',
      sql`char_length(${table.formattedAddress}) between 1 and 300 and (${table.unit} is null or char_length(${table.unit}) <= 40)`,
    ),
    uniqueIndex('device_addresses_device_uidx').on(table.deviceId),
  ],
);

/**
 * Every independent verification run of a device event: the verdict, each
 * check with its detail, and the chain evidence it was based on. Append-only
 * history; device_events.verification_status mirrors the latest row.
 */
export const eventVerifications = pgTable(
  'event_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deviceEventId: uuid('device_event_id')
      .notNull()
      .references(() => deviceEvents.id, { onDelete: 'cascade' }),
    verdict: text('verdict').notNull(),
    checks: jsonb('checks').$type<unknown[]>().notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    // 'worker', 'public', or 'admin:<username>'.
    checkedBy: text('checked_by').notNull(),
    rpcHost: text('rpc_host'),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'event_verifications_verdict_check',
      sql`${table.verdict} in ('pending', 'verified', 'verified_with_warnings', 'unverified')`,
    ),
    index('event_verifications_event_checked_idx').on(
      table.deviceEventId,
      table.checkedAt,
    ),
  ],
);

/**
 * The admin role, separate from dashboard principals. One fixed `Admin`
 * account whose password hash is synced from ADMIN_PASSWORD. Admin actions
 * (e.g. verifications) are attributed to `username`.
 */
export const adminAccounts = pgTable(
  'admin_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      'admin_accounts_hash_check',
      sql`char_length(${table.passwordHash}) between 20 and 500`,
    ),
    uniqueIndex('admin_accounts_username_uidx').on(table.username),
  ],
);

/**
 * Every DeviceEvent log observed on the DeviceNFT contract — written by this
 * app or anyone else holding UPDATER_ROLE. Filled by the forward scanner,
 * explorer backfill. Lets admin reconcile what is on
 * chain against what this app recorded (matched / missing / orphan).
 */
export const chainDeviceEvents = pgTable(
  'chain_device_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    contractAddress: text('contract_address').notNull(),
    tokenId: text('token_id').notNull(),
    eventType: smallint('event_type').notNull(),
    transactionHash: text('transaction_hash').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    logIndex: bigint('log_index', { mode: 'number' }).notNull(),
    dataHash: text('data_hash').notNull(),
    payloadUtf8: text('payload_utf8'),
    blockTimestamp: timestamp('block_timestamp', { withTimezone: true }),
    // 'scan' (forward RPC scanner) | 'explorer' (history backfill)
    discoveredVia: text('discovered_via').notNull(),
    discoveredAt: timestamp('discovered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'chain_device_events_discovered_via_check',
      sql`${table.discoveredVia} in ('scan', 'explorer')`,
    ),
    uniqueIndex('chain_device_events_log_uidx').on(
      table.chainId,
      table.transactionHash,
      table.logIndex,
    ),
    index('chain_device_events_token_idx').on(
      table.chainId,
      table.contractAddress,
      table.tokenId,
      table.blockNumber,
    ),
  ],
);

/** How far the forward scanner has read each contract (inclusive). */
export const chainScanCursors = pgTable(
  'chain_scan_cursors',
  {
    chainId: bigint('chain_id', { mode: 'bigint' }).notNull(),
    contractAddress: text('contract_address').notNull(),
    lastScannedBlock: bigint('last_scanned_block', {
      mode: 'bigint',
    }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.chainId, table.contractAddress] })],
);

export const schemaMeta = {
  tables: [
    'principals',
    'wallets',
    'principal_wallets',
    'dashboard_password_credentials',
    'pending_device_connections',
    'enode_connections',
    'devices',
    'webhook_deliveries',
    'outbox_events',
    'charging_sessions',
    'odometer_readings',
    'daily_odometer',
    'device_events',
    'device_addresses',
    'event_verifications',
    'admin_accounts',
    'chain_device_events',
    'chain_scan_cursors',
  ],
} as const;
