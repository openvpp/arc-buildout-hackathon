# Enode integration

**Status:** vehicle Link onboarding + webhook ingest implemented; live Enode
HTTP sync beyond Link remains limited to credentials you configure.

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

`POST /api/webhooks/enode` → `webhook_deliveries` → outbox `PROCESS_ENODE_WEBHOOK`
→ immutable `telemetry_records` + content hash.

Never claim `ANCHORED` from webhook processing.

## Configuration

Secrets must never be `NEXT_PUBLIC_*`.
