# Database

PostgreSQL via Drizzle. Schema source of truth:
[`src/server/infrastructure/db/schema/index.ts`](../src/server/infrastructure/db/schema/index.ts).
Migrations live in `drizzle/migrations/`; generate new ones with
`pnpm db:generate`, apply with `pnpm db:migrate`. Never edit an applied
migration — add a new one.

## Tables

| Table                        | Purpose                                                                           | Key constraints                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `principals`                 | Dashboard user identity (`type='dashboard_user'`, `displayName='circle:<email>'`) | unique `(type, display_name)`                                                                                                      |
| `wallets`                    | Circle developer-controlled wallet (`wallet_type='circle'`)                       | unique `(chain_id, normalized_address)`, unique `circle_wallet_id`                                                                 |
| `principal_wallets`          | Ownership: principal ↔ wallet                                                     | PK `(principal_id, wallet_id)`                                                                                                     |
| `pending_device_connections` | Enode Link onboarding wizard state                                                | status enum incl. `pending_oauth → oauth_completed/pending_form → completed/failed/expired/cancelled`                              |
| `enode_connections`          | One connected Enode user per wallet                                               | unique `external_user_id`                                                                                                          |
| `devices`                    | The vehicle: identity, mint state, last known location                            | unique `(provider, external_device_id)` — this is what makes re-linking the same physical vehicle an upsert, never a duplicate row |
| `webhook_deliveries`         | Enode webhook dedup                                                               | unique `(provider, delivery_id)`                                                                                                   |
| `outbox_events`              | Crash-safe async job queue (currently: `MINT_DEVICE_NFT`)                         | `locked_at` lease; partial unique index allows one active mint job per device                                                      |
| `charging_sessions`          | Off-chain charging sessions derived from Enode `chargeState` (incl. location)     | unique `session_id`; partial unique index: one `active` session per device; closed sessions must have `end_time`                   |
| `odometer_readings`          | Raw off-chain odometer readings (km)                                              | unique `(device_id, observed_at)`                                                                                                  |
| `daily_odometer`             | Per-device, per-UTC-day odometer aggregate (`open → finalized`)                   | unique `(device_id, date_utc)`; `end_odometer_km >= start_odometer_km`                                                             |
| `device_addresses`           | Owner-entered device address (personal data), one per device                      | unique `device_id`; coordinate ranges; ISO country code; cascade-deleted with the device                                           |
| `device_events`              | The on-chain time series: one row per `recordDeviceEvent` call                    | unique `(source_type, source_id, event_type)`; unique non-null `transaction_hash`; `confirmed` requires tx + token id              |

## `devices` mint lifecycle

`mint_status`: `unminted → pending → minted | failed`.

- `mint_claimed_at` bounds how long a `pending` claim is honored (10 minutes
  — see `MINT_CLAIM_LEASE_MS` in `mint-device-nft.ts`); a crashed worker's
  claim becomes reclaimable after that window.
- `outbox_events.locked_at` is the worker's claim on a job. A `processing`
  row older than 30 minutes is returned to `pending` so a crashed worker
  does not leave the mint stuck. A broadcast transaction hash still
  reconciles instead of minting again.
- `outbox_events_one_active_mint_uidx` allows only one `pending` or
  `processing` `MINT_DEVICE_NFT` row per device. Apply
  `0002_outbox_lock_and_location_index` before running the new worker. If
  that unique index fails to create, delete duplicate active mint rows for
  the same device and retry the migration. Rolling the app back is safe
  while the new nullable column and indexes remain; drop them only after
  the previous app version is what is running.
- `nft_transaction_hash` is written the instant the mint tx is broadcast —
  before confirmation — so a crash between broadcast and confirmation
  reconciles against the in-flight tx on the next attempt instead of
  minting a second NFT for the same device.
- `nft_token_id` is only ever set once; the application layer refuses to
  mutate it after a successful mint.

## `devices` class / on-chain type

`device_type` is constrained (`devices_device_type_check`) to the on-chain
device-class taxonomy defined in
[`device-types.ts`](../src/server/infrastructure/blockchain/device-types.ts)
— the same source of truth used to resolve the `typeId` argument to the
deployed DeviceNFT contract's `mintDevice`. Only `electric_vehicle` is ever
written by this app's onboarding flow; the other classes
(`charger`/`battery`/`solar`/`thermostat`) are reserved in the constraint to
mirror the contract's typeId space, not because this milestone onboards
them — see CLAUDE.md's scope boundary. Minting resolves `typeId` from this
column, not from a flat env var, so an unrecognized class fails the mint
loudly instead of guessing.

## `devices` location

`last_latitude`/`last_longitude`/`last_location_at` are denormalized from
whatever Enode last reported (webhook or finalize-time snapshot). Location
has no history table: the globe only needs "where is it right now." (The
charging/odometer time series below is separate and never publishes
location.) A device with no reported location simply has
`null` here and is excluded from the globe query
(`list-device-locations.ts`), not given a fallback pin.

## On-chain time series (`device_events`)

Full device activity is stored off-chain in `charging_sessions`,
`odometer_readings` and `daily_odometer`. Only a whitelisted, non-sensitive
subset is published on-chain via the DeviceNFT contract's
`recordDeviceEvent(tokenId, eventType, data)`:

- `eventType = 2` (CHARGING_COMPLETED), one per completed charging session.
- `eventType = 12` (TRIP_COMPLETED), one per device per finalized UTC day.

`device_events.payload_json` is the exact UTF-8 JSON sent as `data`, fixed
when the row is created; `payload_hash` is its keccak256, so any row can be
matched to its on-chain log. Location is never part of the payload.

`status`: `queued → pending → confirmed | failed`.

- An event for a device that is not minted yet stays `queued` until the mint
  confirms — it is never dropped.
- `transaction_hash` is written at broadcast, before confirmation, so a crash
  reconciles against the in-flight tx instead of recording the event twice.
- `device_events_source_uidx` makes publishing a session/day idempotent.
- `confirmed` is only set from a confirmed receipt; the database rejects a
  `confirmed` row without a transaction hash and token id.

## Device addresses (`device_addresses`)

The address the owner enters at onboarding (required) or later on the device
page. The browser sends only the address text; the server geocodes it with
Mapbox and stores the canonical address and coordinates.

- `latitude`/`longitude` and the address text are owner-only.
- `public_latitude`/`public_longitude` are what the public globe shows: a
  stable point 0.5–2 km from the real one, derived from an HMAC of the
  device + place (secret: `LOCATION_OBFUSCATION_SECRET`, falling back to
  `API_KEY_HASH_SECRET`). It is fixed when the address is saved, so rotating
  the secret does not move existing address pins.
- A device without an address falls back to its live Enode location with
  the same kind of offset, computed at query time.
- `geocoded_permanent` records whether Mapbox was asked for a storable
  (`permanent=true`) result.
- Nothing in this table is ever published on-chain.
