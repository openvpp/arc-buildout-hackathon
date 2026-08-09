# API

OpenAPI 3.1 lives at [`openapi/openapi.json`](../openapi/openapi.json) and is
served by `GET /api/openapi`. Source of truth for path inventory:
`src/server/transport/http/openapi-document.ts`.

## Health / meta

| Method | Path             | Purpose                                              |
| ------ | ---------------- | ---------------------------------------------------- |
| `GET`  | `/api/health`    | Liveness (no dependency checks)                      |
| `GET`  | `/api/readiness` | Config + PostgreSQL readiness (`503` when not ready) |
| `GET`  | `/api/openapi`   | OpenAPI document                                     |

All dynamic API responses use `Cache-Control: no-store` and echo `X-Request-Id`.

## Agent (Circle Gateway)

| Method | Path                             | Purpose                                                                       |
| ------ | -------------------------------- | ----------------------------------------------------------------------------- |
| `POST` | `/api/v1/agent/telemetry/latest` | Latest-only purchase: `NO_*` / `402 PAYMENT_REQUIRED` / `TELEMETRY_DELIVERED` |

Auth: `X-Api-Key`. Optional header: `payment-signature` (base64 Circle payload).
On `402`, response includes `PAYMENT-REQUIRED` (x402 v2, `GatewayWalletBatched`).

Primary payment path is **settle on this same POST**, not a separate proofs route.
`POST /api/v1/payments/proofs` is **not implemented** (deferred / unused).

## Webhooks

| Method | Path                  | Purpose                                     |
| ------ | --------------------- | ------------------------------------------- |
| `POST` | `/api/webhooks/enode` | Accept Enode webhook → persist → outbox job |

## Dashboard reads

| Method | Path                                       | Purpose                                   |
| ------ | ------------------------------------------ | ----------------------------------------- |
| `GET`  | `/api/v1/wallets`                          | List wallets for principal                |
| `GET`  | `/api/v1/wallets/{walletId}`               | Wallet + devices                          |
| `GET`  | `/api/v1/devices/{deviceId}/telemetry`     | Latest telemetry + verification           |
| `GET`  | `/api/v1/verification/{telemetryRecordId}` | Agent verification snapshot               |
| `POST` | `/api/v1/verification/results`             | Persist agent Step-6 verification outcome |

Dashboard APIs do **not** execute nanopayments.

Agent `POST /verification/results` stores **agent-reported** evidence only
(`source: agent_reported`). It is not server-authoritative chain authorization.

## Dashboard session / owner BFF (documented; OpenAPI deferred)

These live routes are intentionally thinner / demo-named and are **not yet** in
the generated OpenAPI contract (`pnpm openapi:check` only covers listed paths):

| Method | Path                                               | Purpose                               |
| ------ | -------------------------------------------------- | ------------------------------------- |
| `POST` | `/api/v1/dashboard/session`                        | Bind Web3Auth owner session / wallet  |
| `POST` | `/api/v1/demo/telemetry/latest`                    | Owner quote/settle BFF (Circle buyer) |
| `POST` | `/api/v1/demo/telemetry/verify`                    | Owner Arc + hash re-check             |
| `POST` | `/api/v1/vehicle-onboarding/link`                  | Start Enode OAuth link                |
| `GET`  | `/api/v1/vehicle-onboarding/oauth/enode-complete`  | OAuth return                          |
| `GET`  | `/api/v1/vehicle-onboarding/pending/{id}`          | Pending connection                    |
| `POST` | `/api/v1/vehicle-onboarding/pending/{id}/complete` | Finalize + mint job                   |

Treat them as in-app BFF surfaces until OpenAPI coverage is extended.

## Error contract

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Service is not ready.",
    "requestId": "uuid",
    "details": {}
  }
}
```

`402 Payment Required` is an expected domain response (not `INTERNAL_ERROR`).

## Authentication

Agents authenticate with `X-Api-Key`. Only a keyed hash is stored; the complete
credential is returned once at creation (`pnpm db:seed` prints a demo key).

## Payment vs provenance fields

Never conflate:

- `paymentTransactionHash` — Circle Gateway **settlement** tx
- `anchorTransactionHash` — DeviceNFT `recordDeviceEvent` tx (content-hash commitment)

## Generating / checking OpenAPI

```bash
pnpm openapi:generate
pnpm openapi:check
```
