# Runbooks

Each runbook: detection → containment → diagnosis → remediation → reconciliation → audit.

Primary payment rail is **Circle Gateway settle on the agent telemetry POST**.
Legacy async ERC-20 `VERIFY_ARC_PAYMENT` reconciliation is a stub / future path —
do not treat it as the live money flow.

## PostgreSQL unavailable

- **Detect:** readiness `503`, worker errors, elevated DB timeouts
- **Contain:** keep liveness up; pause deploys that need writes
- **Diagnose:** connection string, pool exhaustion, disk, failover
- **Remediate:** restore primary / failover; do not bypass payments
- **Reconcile:** after recovery, inspect unfinished deliveries / outbox
- **Audit:** record outage window and actions

**Never** run `docker compose down -v` on the droplet — that deletes the
Postgres volume. Prefer `docker compose stop` / `restart` without `-v`.
Never pay “readme_to_recover” ransom databases; restore from backup or
re-import from Enode (`pnpm enode:import-vehicles`).

## Postgres local backup (droplet)

Nightly dump cron (root): `15 3 * * * /opt/ev-telemetry/scripts/backup-postgres.sh`

- **Path:** `/var/backups/ev-telemetry/ev_telemetry-YYYYMMDD-HHMM.dump` (`-Fc`)
- **Retention:** 7 days
- **Log:** `/var/log/ev-telemetry-backup.log`
- **Manual run:** `bash /opt/ev-telemetry/scripts/backup-postgres.sh`

**Restore (destructive — empty/replace app DB):**

```bash
cd /opt/ev-telemetry
# pick a dump
DUMP=/var/backups/ev-telemetry/ev_telemetry-YYYYMMDD-HHMM.dump

# Drop + recreate app DB inside the container, then restore custom-format dump
docker exec -i ev-telemetry-postgres psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = 'ev_telemetry' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ev_telemetry;
CREATE DATABASE ev_telemetry OWNER postgres;
SQL
docker exec -i ev-telemetry-postgres pg_restore -U postgres -d ev_telemetry --clean --if-exists <"$DUMP"

pm2 restart web worker
curl -fsS http://127.0.0.1:3000/api/readiness
```

If the schema is missing but Enode Links remain, remigrate +
`pnpm enode:import-vehicles` instead of a full restore.

## Circle Gateway facilitator unavailable

- **Detect:** settle failures `PAYMENT_VERIFICATION_UNAVAILABLE` / `402` after signature
- **Contain:** fail closed — do not credit ledger or return paid telemetry
- **Diagnose:** `CIRCLE_GATEWAY_FACILITATOR_URL`, auth token, Circle status
- **Remediate:** restore facilitator; agent retries with a fresh payment signature if needed
- **Reconcile:** payment requirements still `pending` with no ledger credit
- **Audit:** list affected payment requirement IDs

## Arc RPC unavailable (agent Step-6)

- **Detect:** agent verification `TX_MISSING` / `ERROR`; dashboard shows delivery but not `VERIFIED`
- **Contain:** delivery already happened only if settle succeeded — do not re-credit
- **Diagnose:** `ARC_RPC_URL`, rate limits, network
- **Remediate:** restore RPC; re-run agent verification report
- **Reconcile:** verification results vs settlement `paymentTransactionHash`
- **Audit:** telemetry record IDs with missing verification

## Settlement succeeded but ledger/delivery missing

- **Detect:** Circle/explorer shows settlement; no `payment_credit` / delivery row
- **Contain:** stop duplicate signatures for the same requirement
- **Diagnose:** DB transaction failure after settle, unique constraint conflicts
- **Remediate:** idempotent settle/credit path; never insert ledger rows by hand without audit
- **Reconcile:** ledger vs `payment_transactions` vs Circle settlement hash
- **Audit:** mandatory for any financial repair

## Duplicate settlement / transaction attempt

- **Detect:** unique violation on `chain_id + transaction_hash`
- **Contain:** reject second requirement linkage
- **Diagnose:** reuse across agents/requirements
- **Remediate:** return reuse/invalid payment error; keep exactly-once ledger
- **Audit:** record both requirement IDs

## Enode webhook signature failures

- **Detect:** elevated `ENODE_WEBHOOK_INVALID`
- **Contain:** keep endpoint rejecting invalid traffic
- **Diagnose:** secret rotation skew, raw-body mutation, using SHA-256 instead of Enode’s HMAC-SHA1 (`sha1=<hex>`), wrong secret from webhook create
- **Remediate:** rotate/sync secrets; verify against raw bytes; never disable verification in production
- **Audit:** count rejected deliveries

### Operator: rotate Enode sandbox credentials / webhook secret

1. In Enode developer console, rotate **sandbox** `CLIENT_SECRET` (leave sandbox
   API/OAuth URLs unchanged).
2. On the droplet, update `/opt/ev-telemetry/.env.local`:
   - `ENODE_CLIENT_SECRET=…`
   - If rotating the webhook: generate `ENODE_WEBHOOK_SECRET` (e.g. `openssl rand -hex 32`),
     delete/recreate the sandbox webhook with that secret + public tunnel URL
     `…/api/webhooks/enode`.
3. Avoid frozen pm2 env overrides (they beat `--env-file`):

```bash
cd /opt/ev-telemetry
unset ENODE_API_BASE_URL ENODE_OAUTH_TOKEN_URL ENODE_CLIENT_ID \
  ENODE_CLIENT_SECRET ENODE_WEBHOOK_SECRET || true
pm2 delete web worker 2>/dev/null || true
pm2 start pnpm --name web -- start
pm2 start pnpm --name worker -- worker:start
pm2 save
```

4. Smoke-test signature (expect HTTP `202`):

```bash
cd /opt/ev-telemetry
node --env-file-if-exists=.env.local <<'NODE'
const crypto = require('crypto');
const secret = process.env.ENODE_WEBHOOK_SECRET;
const body = Buffer.from(
  '[{"event":"enode:webhook:test","createdAt":"2026-08-08T00:00:00Z","version":"2024-10-01"}]',
);
const sig =
  'sha1=' + crypto.createHmac('sha1', secret).update(body).digest('hex');
require('child_process').execSync(
  `curl -s -i -X POST http://127.0.0.1:3000/api/webhooks/enode ` +
    `-H 'Content-Type: application/json' ` +
    `-H 'x-enode-signature: ${sig}' ` +
    `-H 'x-enode-delivery: test-${Date.now()}' ` +
    `--data-binary '${body.toString()}'`,
  { stdio: 'inherit' },
);
NODE
```

## Worker queue backlog

- **Detect:** rising `outbox_events` pending/failed
- **Contain:** scale worker concurrency carefully
- **Diagnose:** poison messages, Enode processing errors
- **Remediate:** fix handler; replay dead letters intentionally
- **Audit:** dead-letter IDs processed

## Migration failure

- **Detect:** deploy migrate step fails
- **Contain:** do not start mismatched web/worker versions on half-migrated DBs
- **Diagnose:** conflicting DDL, lock timeouts
- **Remediate:** restore backup if needed; apply forward-fix migration
- **Audit:** migration version + operator

## API credential compromise

- **Detect:** anomalous usage, leaked key report
- **Contain:** revoke credential (`revoked_at` / status)
- **Diagnose:** scope of access via audit logs
- **Remediate:** issue new key; rotate `API_KEY_HASH_SECRET` only with a re-hash plan
- **Audit:** revocation event + principal ID

## Device event transaction stuck

- **Detect:** telemetry `anchor_status` stuck in `submitted` (live DeviceNFT `recordDeviceEvent`)
- **Contain:** do not invent `ANCHORED` status
- **Diagnose:** RPC, contract, confirmations
- **Remediate:** confirmation jobs (not implemented yet)
- **Audit:** batch IDs affected

Today deliveries may show provenance `PENDING`; that is expected until DeviceNFT events
is implemented.
