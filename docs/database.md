# Database

PostgreSQL is the authoritative application database. Drizzle ORM defines the
schema; SQL migrations are committed under `drizzle/migrations/`.

## Commands

```bash
pnpm services:up      # local Postgres (+ test Postgres on :5433)
pnpm db:generate      # generate SQL from schema changes
pnpm db:migrate       # apply committed migrations (explicit deploy step)
pnpm db:check         # migration consistency
pnpm db:seed          # explicitly marked demo data
pnpm db:reset:test    # wipe test DB schema only
pnpm db:studio        # Drizzle Studio
```

Never use `drizzle-kit push` against staging/production. Never migrate during
ordinary application startup.

## Tables

| Table                                     | Responsibility                                                  |
| ----------------------------------------- | --------------------------------------------------------------- |
| `principals`                              | Agents, dashboard users, services, admins                       |
| `api_credentials`                         | Hashed API keys, scopes, expiry/revocation                      |
| `wallets`                                 | Chain + normalized address (no private keys)                    |
| `principal_wallets`                       | Principal ↔ wallet authorization                                |
| `enode_connections`                       | Enode user/connection metadata                                  |
| `devices`                                 | Devices per wallet                                              |
| `webhook_deliveries`                      | Raw webhook receipts + dedupe                                   |
| `telemetry_records`                       | Immutable normalized telemetry + content hash + **anchor** refs |
| `agent_device_cursors`                    | Per-agent delivery cursors                                      |
| `payment_requirements`                    | Server-authored USDC payment instructions                       |
| `payment_transactions`                    | On-chain **payment** tx evidence (distinct from anchors)        |
| `ledger_entries`                          | Append-only financial ledger                                    |
| `telemetry_deliveries`                    | Paid delivery records                                           |
| `idempotency_records`                     | Idempotent write tracking                                       |
| `outbox_events`                           | Transactional outbox for the worker                             |
| `audit_logs`                              | Security-sensitive audit trail                                  |
| `anchor_batches` / `anchor_batch_records` | Batch provenance anchoring                                      |
| `rate_limit_buckets`                      | Shared rate-limit store                                         |

## Conventions

- UUIDs, `timestamptz`, UTC, `snake_case`
- Constrained `text` + check constraints (evolvable vs PG enums)
- Monetary values as integer atomic units (`numeric(78,0)` / strings in app code)
- Partial unique indexes for active payment requirements and provider events
- Latest telemetry index: `(device_id, recorded_at DESC, id DESC)`

## Backup & retention (policy)

Production must use automated backups with PITR, encrypted storage, restricted
access, and periodic restore tests. Retention:

- Ledger + audit: retain (no ordinary application deletion)
- Idempotency records: TTL-based expiry
- Raw webhook payloads: bounded retention with redacted logs
- Job history: retain failed/dead-letter for incident review
