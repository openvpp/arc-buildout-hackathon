# Domain overview

End-to-end EV telemetry nanopayment flow in this monorepo.

## The flow

```
Agent
  → POST /api/v1/agent/telemetry/latest
Backend
  → NO_NEW_RECORD | 402 PAYMENT_REQUIRED (Circle Gateway) | deliver
Agent
  → Circle Gateway payment-signature → settle
Backend
  → credits ledger, returns telemetry + settlement tx + contentHash
Agent
  → verifies Arc receipt + content hash (independent evidence)
Dashboard
  → shows telemetry per wallet/device + verification status
```

## Key rules

- Only the **latest** telemetry record is sold.
- Frontend is a viewer; backend owns Enode, Postgres, Circle settle, and hashes.
- Payment settlement tx ≠ provenance/anchor tx.
- Demo wallets/devices come from `pnpm db:seed`.
- On-chain provenance uses DeviceNFT `recordDeviceEvent`; delivered provenance stays `PENDING` until the worker confirms.
