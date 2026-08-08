# Enode integration

**Status:** vehicle Link onboarding + webhook ingest aligned to Enode’s public
webhook contract (HMAC-SHA1, JSON array, nested `vehicle`). On finalize (and via
`pnpm enode:sync-telemetry`), a best-effort baseline telemetry snapshot is
ingested from Enode `GET /vehicles/{id}`; webhooks remain the ongoing update
path.

## Vehicle onboarding (Enode Link)

Ported from OpenVPP vehicle flow into Postgres / Next.js (not Mongo).

### APIs

| Method | Path                                              | Purpose                                 |
| ------ | ------------------------------------------------- | --------------------------------------- |
| `POST` | `/api/v1/vehicle-onboarding/link`                 | Create pending + Enode `linkUrl`        |
| `GET`  | `/api/v1/vehicle-onboarding/oauth/enode-complete` | After OEM redirect                      |
| `GET`  | `/api/v1/vehicle-onboarding/pending/:id`          | Pending status                          |
| `POST` | `/api/v1/vehicle-onboarding/pending/:id/complete` | Persist `devices` + `enode_connections` |

### FE

- `/devices/onboard` — start Link (Web3Auth Bearer + wallet connect)
- `/enode/complete` — OAuth return + nickname finalize

**Identity:** Onboarding APIs require `Authorization: Bearer <Web3Auth
idToken>`. The server verifies the JWT (JWKS) and takes the EVM wallet from
the token’s `wallets` claims (body `walletAddress` is only a hint when it
matches). It then upserts a `dashboard_user` principal (prefer email display
name `web3auth:<email>`) + `principal_wallets` (`owner`). With
`ALLOW_MOCK_ADAPTERS=true`, `Bearer mock:0x…` is accepted for local tests
only.

### Env

See `.env.example` (`ENODE_*`, `PENDING_DEVICE_OAUTH_TTL_HOURS`). Register
`ENODE_REDIRECT_URI` in the Enode developer console.

### Tables

- `pending_device_connections` — wizard state
- `enode_api_tokens` — cached client-credentials bearer
- `enode_connections` / `devices` — canonical rows (`external_device_id` = Enode vehicle id)

## Webhook flow

```text
POST /api/webhooks/enode
  → verify x-enode-signature (HMAC-SHA1, sha1=<hex>)
  → dedupe on x-enode-delivery (or body hash)
  → insert webhook_deliveries + outbox PROCESS_ENODE_WEBHOOK (one transaction)
  → 202 accepted

worker
  → explode JSON array (≤100 events)
  → for each user:vehicle:updated / discovered:
       map vehicle.chargeState|odometer|location
       → find device by external_device_id
       → insert telemetry_records + content hash
       → enqueue ANCHOR_TELEMETRY (worker → DeviceNFT recordDeviceEvent mock/live)
```

Never claim `ANCHORED` from webhook processing.

### Signature

- Algorithm: **HMAC-SHA1** over the **raw** body
- Header: `x-enode-signature: sha1=<hex>`
- Delivery id: `x-enode-delivery` (preferred idempotency key)
- You generate the secret (min 128 bits) when creating the webhook in Enode

Local example (matches Enode docs): body `{"payload":"example"}` + secret
`example-secret` → `sha1=e417e6fc2e7f8a78c93a35a7b344d36ce179fc8d`.

### Payload contract

Body is a **JSON array**. Production vehicle updates look like:

```json
[
  {
    "event": "user:vehicle:updated",
    "createdAt": "2020-04-07T17:04:26Z",
    "version": "2024-10-01",
    "user": { "id": "..." },
    "vehicle": {
      "id": "<enode-vehicle-id>",
      "chargeState": { "batteryLevel": 72, "isCharging": true },
      "odometer": { "distance": 12000 },
      "location": { "latitude": 37.77, "longitude": -122.42 }
    },
    "updatedFields": ["chargeState"]
  }
]
```

`enode:webhook:test` / heartbeats are accepted then marked `unsupported` (no
telemetry). Unknown vehicles retry until the worker dead-letters (onboarding
race) or succeed after Link finalize.

### Still deferred

- IP allowlist refresh from Enode DNS TXT (static `ENODE_WEBHOOK_ALLOWED_IPS` is wired)
- Continuous Enode HTTP pull / reconcile worker (onboard snapshot + CLI sync exist)

## Arc DeviceNFT mint (on finalize)

When configured, `POST .../pending/:id/complete` mints a DeviceNFT on Arc after
persisting the Postgres device. Fail-open: link succeeds even if mint fails
(`mintWarning` in the response).

```bash
USE_ARC_NETWORK=true
ARC_RPC_URL=https://rpc.testnet.arc.network/<token>
ARC_CHAIN_ID=5042002
ARC_AUTH_TOKEN=<token>
DEVICE_NFT_CONTRACT_ADDRESS=0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908
DEVICE_NFT_MINTER_PRIVATE_KEY=0x…   # demo/dev only
DEVICE_NFT_TYPE_ID=1
```

Mint stores `nft_token_id`, `nft_transaction_hash`, `nft_metadata_uri`, and
`network` on `devices`. Payment settlement hashes remain separate.

Canonical id chain:

`Enode vehicle.id` → `pending.provider_device_id` → `devices.external_device_id`

## Onboard + API telemetry snapshot

`POST .../pending/:id/complete` already fetches Enode `GET /vehicles/{id}` for
make/model. When that body includes non-empty `chargeState` / odometer /
location readings, finalize also inserts one `telemetry_records` row
(`source=enode-onboard-snapshot`) and enqueues `ANCHOR_TELEMETRY`. Empty charge
does **not** fail onboarding — the UI keeps `—` until a webhook or sync fills
it. Capacity is never invented when Enode omits `batteryCapacity`.

Backfill already-onboarded devices (missing SoC or capacity on latest row):

```bash
pnpm enode:sync-telemetry -- --missing-only
pnpm enode:sync-telemetry -- --device-id <uuid>
```

## Agent device discovery

Demo agent does **not** require `AGENT_DEVICE_ID`. It calls
`GET /api/v1/agent/devices/latest?walletAddress=` and uses the newest onboarded
device for that wallet (Enode-linked preferred). Optional `AGENT_DEVICE_ID`
overrides discovery.

## Configuration

Secrets must never be `NEXT_PUBLIC_*`. Production/staging require
`ENODE_WEBHOOK_SECRET`.
