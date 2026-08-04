# Enode integration

**Status:** vehicle Link onboarding + webhook ingest aligned to Enode’s public
webhook contract (HMAC-SHA1, JSON array, nested `vehicle`). Live HTTP sync /
reconcile beyond Link remains optional.

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

- `/devices/onboard` — start Link (temporary wallet address stub)
- `/enode/complete` — OAuth return + nickname finalize

**Identity:** wallet address in body/localStorage until Web3Auth.

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
       → enqueue deferred ANCHOR_TELEMETRY (no-op until BatchAnchor)
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

- IP allowlist from Enode DNS TXT (`ENODE_WEBHOOK_ALLOWED_IPS` env is reserved)
- Live Enode HTTP pull / reconcile jobs
- BatchAnchor confirming `ANCHORED`

## Configuration

Secrets must never be `NEXT_PUBLIC_*`. Production/staging require
`ENODE_WEBHOOK_SECRET`.
