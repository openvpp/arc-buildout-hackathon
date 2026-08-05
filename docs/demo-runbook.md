# Runnable live demo

Stakeholder click-through for the EV telemetry nanopayment vertical slice.

**What this proves**

1. Demo (or Enode-linked) wallet + device exist
2. A new telemetry record is available to sell
3. Agent `POST` → `402` → settle → delivery
4. Agent reports verification → dashboard shows it

**Honesty rules**

- Mock settlement (`ALLOW_MOCK_ADAPTERS=true`) is **not** live payment evidence.
- `pnpm demo:inject-telemetry` inserts **demo-marked** sandbox data (`ENODE_SANDBOX`, `source=demo-inject`) — never claim it is a live Enode vehicle.
- Provenance anchors via worker (`ANCHOR_TELEMETRY` → `CHECK_ANCHOR_CONFIRMATIONS`).
  Demo `.env.example` uses `PROVENANCE_DELIVERY_MODE=pending` so clicks work before
  the worker confirms; use `strict` only with the worker running.

Two paths below: **A mock** (fastest) and **B live Circle checklist**.

---

## A. Mock path (recommended first)

No Circle funds, no Enode OEM login required.

### A1. One-time setup

```bash
corepack enable
pnpm install
pnpm services:up
cp .env.example .env.local
# Ensure:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ev_telemetry
#   API_KEY_HASH_SECRET=<≥32 chars>
#   ALLOW_MOCK_ADAPTERS=true
#   PROVENANCE_DELIVERY_MODE=pending
#   APP_ENV=development
pnpm db:migrate
pnpm db:seed
```

Copy the printed `AGENT_*` lines into `.env.local` (API key is shown **once**).

### A2. Inject sellable telemetry

```bash
pnpm demo:inject-telemetry
```

Repeat this whenever you need a **new** unpaid record (agent otherwise gets
`NO_NEW_RECORD` after a successful purchase).

### A3. Start processes (3 terminals)

```bash
pnpm dev                 # http://localhost:3000
pnpm worker:dev          # mock BatchAnchor submit/confirm (needed for ANCHORED / strict)
pnpm agent:dev           # polls latest telemetry
```

With mocks enabled, the agent does **not** need `ARC_PAYMENT_SIGNER_PRIVATE_KEY`.
With `PROVENANCE_DELIVERY_MODE=pending`, the agent can settle before the worker
marks the record `anchored`.

### A4. Expected agent log sequence

1. First poll with a fresh record → settle → `TELEMETRY_DELIVERED`
2. Verification report (mock txs are not on-chain; agent still may report
   `VERIFIED` when mocks are allowed)
3. Later polls → `NO_NEW_RECORD` until you inject again

### A5. Dashboard checks

| URL          | Expect                                                |
| ------------ | ----------------------------------------------------- |
| `/wallets`   | Seed wallet `0x1111…1111`                             |
| `/devices`   | Demo Device (seed)                                    |
| `/dashboard` | Latest delivery + verification for that wallet/device |

If the dashboard is empty, confirm seed ran against the same `DATABASE_URL` as
`pnpm dev`, and that the agent settled at least once.

### A6. Optional: Enode Link UI

With Enode sandbox credentials **and** Web3Auth Client ID
(`NEXT_PUBLIC_WEB3AUTH_CLIENT_ID`, Sapphire Devnet):

1. Register `ENODE_REDIRECT_URI` (e.g. `http://localhost:3000/enode/complete`)
2. Open `/devices/onboard`, connect Web3Auth, start Link
3. Complete OEM OAuth → nickname → device appears under `/devices`

This does **not** replace inject for the agent demo unless you also ingest real
webhook telemetry for that device (Path B / production Enode work).

---

## B. Live Circle checklist

Use when demoing real Gateway settle on Arc testnet. Keep
`ALLOW_MOCK_ADAPTERS=false`.

### B1. Required env (server)

```bash
ALLOW_MOCK_ADAPTERS=false
APP_ENV=development          # or demo — not production for env buyer key
SELLER_WALLET_ADDRESS=0x...  # required; demo 0x1111… is rejected
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
ARC_USDC_CONTRACT_ADDRESS=0x3600000000000000000000000000000000000000
CIRCLE_GATEWAY_FACILITATOR_URL=https://gateway-api-testnet.circle.com
CIRCLE_GATEWAY_AUTH_TOKEN=...
CIRCLE_GATEWAY_WALLET_ADDRESS=0x...
ARC_PAYMENT_SIGNER_PRIVATE_KEY=0x...   # buyer — DEMO/DEV ONLY
# fund buyer Gateway balance / set ARC_GATEWAY_AUTO_DEPOSIT_AMOUNT as needed
AGENT_API_KEY=...                      # from seed or issued credential
AGENT_WALLET_ADDRESS=0x...             # payer / agent wallet address
# AGENT_DEVICE_ID=...                  # optional override; else auto-discover
AGENT_API_BASE_URL=http://localhost:3000
```

Never put private keys in `NEXT_PUBLIC_*`.

### B2. Run

Same process split as A3 (`pnpm dev` + `pnpm agent:dev`). Ensure a real telemetry
row exists for `AGENT_DEVICE_ID` (inject for sandbox data, or Enode webhook for
live hardware).

### B3. Success criteria

- Settlement `paymentTransactionHash` visible on Arc explorer
- Agent verification `receiptFound=true` and status `VERIFIED`
- Dashboard shows delivery; do **not** treat payment tx as BatchAnchor tx

### B4. Failure modes (fail closed)

| Symptom                            | Meaning                                       |
| ---------------------------------- | --------------------------------------------- |
| `PAYMENT_VERIFICATION_UNAVAILABLE` | Facilitator/RPC issue — no ledger credit      |
| `PAYMENT_TRANSACTION_REUSED`       | Settlement hash already used on another buy   |
| Agent `TX_MISSING`                 | Delivery may exist; Arc receipt not found yet |
| `402` after signature              | Settle rejected — retry with fresh signature  |

Ops detail: [`docs/runbooks.md`](./runbooks.md).

---

## Quick reference

| Command                      | Role                                    |
| ---------------------------- | --------------------------------------- |
| `pnpm services:up`           | Postgres                                |
| `pnpm db:migrate`            | Schema                                  |
| `pnpm db:seed`               | Demo principal, API key, wallet, device |
| `pnpm demo:inject-telemetry` | One new demo telemetry row              |
| `pnpm dev`                   | API + dashboard                         |
| `pnpm worker:dev`            | Enode webhook outbox                    |
| `pnpm agent:dev`             | Buyer poll loop                         |

Related docs: [`payment-flow.md`](./payment-flow.md),
[`enode-integration.md`](./enode-integration.md),
[`development.md`](./development.md).
