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
- **Diagnose:** secret rotation skew, raw-body mutation, IP allowlist
- **Remediate:** rotate/sync secrets; never disable verification in production
- **Audit:** count rejected deliveries

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

## Anchor transaction stuck (BatchAnchor — deferred)

- **Detect:** telemetry `anchor_status` stuck in `submitted` (when BatchAnchor is live)
- **Contain:** do not invent `ANCHORED` status
- **Diagnose:** RPC, contract, confirmations
- **Remediate:** confirmation jobs (not implemented yet)
- **Audit:** batch IDs affected

Today deliveries may show provenance `PENDING`; that is expected until BatchAnchor
is implemented.
