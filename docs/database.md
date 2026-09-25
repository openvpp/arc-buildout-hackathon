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
| `outbox_events`              | Crash-safe async job queue (currently: `MINT_DEVICE_NFT`)                         | polled by `src/worker/index.ts`                                                                                                    |

## `devices` mint lifecycle

`mint_status`: `unminted → pending → minted | failed`.

- `mint_claimed_at` bounds how long a `pending` claim is honored (10 minutes
  — see `MINT_CLAIM_LEASE_MS` in `mint-device-nft.ts`); a crashed worker's
  claim becomes reclaimable after that window.
- `nft_transaction_hash` is written the instant the mint tx is broadcast —
  before confirmation — so a crash between broadcast and confirmation
  reconciles against the in-flight tx on the next attempt instead of
  minting a second NFT for the same device.
- `nft_token_id` is only ever set once; the application layer refuses to
  mutate it after a successful mint.

## `devices` location

`last_latitude`/`last_longitude`/`last_location_at` are denormalized from
whatever Enode last reported (webhook or finalize-time snapshot). There is
no telemetry history table — this milestone only needs "where is it right
now," not a time series. A device with no reported location simply has
`null` here and is excluded from the globe query
(`list-device-locations.ts`), not given a fallback pin.
