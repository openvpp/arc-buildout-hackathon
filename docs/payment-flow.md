# Payment flow

**Status:** Circle Gateway x402 vertical slice implemented in this monorepo.

## Rail

Live payments use **Circle Gateway batching** (`GatewayWalletBatched`), not a
raw ERC-20 `transfer` from the agent wallet.

1. Agent `POST /api/v1/agent/telemetry/latest`
2. Backend returns `402` JSON + `PAYMENT-REQUIRED` (x402 v2)
3. Agent signs Gateway payload (`BatchEvmScheme`) and retries with
   `payment-signature`
4. Backend `BatchFacilitatorClient.settle()` → settlement `paymentTransactionHash`
5. Ledger credit + delivery + cursor advance in one Postgres transaction
6. Agent verifies settlement receipt on Arc (when live) and reports content-hash
   verification to `POST /api/v1/verification/results`
7. Dashboard displays latest telemetry per wallet/device + verification status

## Non-negotiables

- Never return paid telemetry before settle + ledger/delivery commit
- Never conflate `paymentTransactionHash` with `anchorTransactionHash`
- Production forbids mock adapters and raw buyer private keys in env
- Live mode (`ALLOW_MOCK_ADAPTERS=false`) **requires** a real `SELLER_WALLET_ADDRESS`
  (demo `0x1111…` is forbidden)
- Settlement `transactionHash` cannot be reused across different payment requirements
- Only the latest telemetry record is sold; otherwise `NO_NEW_RECORD`

## Mock vs live evidence

| Mode             | Settle                            | Agent Step-6                              | CI                                                      |
| ---------------- | --------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Mock adapters    | Deterministic fake hash           | May report `VERIFIED` without Arc receipt | Default for unit/demo                                   |
| Live facilitator | `BatchFacilitatorClient.settle()` | Expect Arc receipt + hash check           | Inject facilitator **double** — never real Circle funds |

## Pricing

Server-side `TELEMETRY_PRICE_USDC_ATOMIC` (default `400` = `0.0004` USDC).

## Demo runbook

1. `pnpm services:up && pnpm db:migrate && pnpm db:seed`
2. `pnpm demo:inject-telemetry` — one sellable **demo-marked** telemetry row
3. Start API: `pnpm dev`
4. Optional worker: `pnpm worker:dev` (Enode webhook processing)
5. Set `AGENT_*` from seed output; with mocks: `ALLOW_MOCK_ADAPTERS=true`
   (no buyer key). Live Circle: see checklist in
   [`docs/demo-runbook.md`](./demo-runbook.md).
6. `pnpm agent:dev`

Full stakeholder walkthrough (mock + live): [`docs/demo-runbook.md`](./demo-runbook.md).

### Facilitator / RPC outages

- Facilitator down → settle returns `PAYMENT_VERIFICATION_UNAVAILABLE` (402); no ledger credit.
- Arc RPC down → agent verification reports `TX_MISSING` / `ERROR`; dashboard still shows delivery.
- Never treat mock settlement as live payment evidence.
