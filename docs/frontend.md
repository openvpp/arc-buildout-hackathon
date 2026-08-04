# Frontend

Dashboard viewer + onboarding UI for the EV telemetry nanopayment platform.

**Role:** the frontend is a **viewer**. It does **not** pay for telemetry. The
autonomous agent (`pnpm agent:dev`) owns `402` → settle → delivery. On-chain
checks shown in the UI are evidence, not authorization.

## App routes (pages)

| Route              | File                                           | Kind   | Purpose                                                       |
| ------------------ | ---------------------------------------------- | ------ | ------------------------------------------------------------- |
| `/`                | `src/app/page.tsx`                             | Server | Landing (boilerplate); links to dashboard                     |
| `/dashboard`       | `src/app/(dashboard)/dashboard/page.tsx`       | Server | Overview: wallets → devices → latest telemetry + verification |
| `/wallets`         | `src/app/(dashboard)/wallets/page.tsx`         | Server | Bound wallets list                                            |
| `/devices`         | `src/app/(dashboard)/devices/page.tsx`         | Server | Devices list + link to onboard                                |
| `/devices/onboard` | `src/app/(dashboard)/devices/onboard/page.tsx` | Client | Web3Auth connect → start Enode Link                           |
| `/enode/complete`  | `src/app/enode/complete/page.tsx`              | Client | Enode OAuth return → nickname → finalize device               |

Shell: `(dashboard)` routes use `src/app/(dashboard)/layout.tsx` +
`src/components/layout/dashboard-shell.tsx` (sidebar nav). `/enode/complete`
is outside that shell (OAuth return URL).

## Page data & auth

| Surface                               | How data loads                                                   | Auth                                       |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `/dashboard`, `/wallets`, `/devices`  | RSC → `loadDashboardSnapshot()` → Postgres (`principal_wallets`) | None yet (lists all bound wallets)         |
| `/devices/onboard`, `/enode/complete` | Client → `createOnboardingApi()`                                 | Web3Auth `Authorization: Bearer <idToken>` |

Requires `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` (Sapphire Devnet) for onboarding UI.
Without it, onboarding shows an unconfigured state.

## Add-vehicle FE flow

```text
/devices/onboard
  → Web3Auth connect
  → POST /api/v1/vehicle-onboarding/link  (Bearer idToken)
  → redirect to Enode Link URL
  → OEM OAuth
  → /enode/complete?ovppPending=…
  → GET  /api/v1/vehicle-onboarding/oauth/enode-complete
  → POST /api/v1/vehicle-onboarding/pending/:id/complete
  → device appears under /devices
```

## Dashboard mock buy flow (demo only)

On `/dashboard`, each device card includes **Request latest** / **Pay (mock)**.

```text
Request latest
  → POST /api/v1/demo/telemetry/latest { action: "quote" }
  → NO_TELEMETRY_AVAILABLE | NO_NEW_RECORD | PAYMENT_REQUIRED | …

Pay (mock)
  → POST /api/v1/demo/telemetry/latest { action: "settle" }
  → mock Circle settle → TELEMETRY_DELIVERED
```

Requires `ALLOW_MOCK_ADAPTERS=true` and `AGENT_API_KEY` in `.env.local` (server).
Not live payment evidence. Production-style buyer remains the agent process.

## What the FE does **not** do

- Call agent purchase `POST /api/v1/agent/telemetry/latest` directly (uses demo BFF)
- Live Circle settlement (mock path only when adapters allowed)
- Post verification results (agent does `POST /api/v1/verification/results`)

## Feature modules

| Feature                     | Public surface                           | Notes                                            |
| --------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `src/features/auth`         | Web3Auth connect / session / id token    | FE wallet identity                               |
| `src/features/onboarding`   | `createOnboardingApi`                    | Typed client for Link / OAuth / finalize         |
| `src/features/dashboard`    | Snapshot loader + mock Request/Pay panel | Demo buy BFF client                              |
| `src/features/telemetry`    | Gateway + schemas                        | Typed client exists; dashboard uses RSC/DB today |
| `src/features/verification` | Status helpers                           | Badge tone on dashboard                          |
| `src/features/wallets`      | Address formatting                       | Display helpers                                  |

Import features only via each package’s `index.ts`.

## Related backend routes (not FE pages)

Called by the FE onboarding client or by agents/workers — not Next.js pages:

| Method | Path                                              | Consumer                                      |
| ------ | ------------------------------------------------- | --------------------------------------------- |
| `POST` | `/api/v1/vehicle-onboarding/link`                 | FE onboard                                    |
| `GET`  | `/api/v1/vehicle-onboarding/oauth/enode-complete` | FE complete                                   |
| `POST` | `/api/v1/vehicle-onboarding/pending/:id/complete` | FE complete                                   |
| `GET`  | `/api/v1/devices/:deviceId/telemetry`             | Available read API (dashboard uses DB loader) |
| `POST` | `/api/v1/demo/telemetry/latest`                   | FE dashboard mock buy (ALLOW_MOCK_ADAPTERS)   |
| `POST` | `/api/v1/agent/telemetry/latest`                  | Agent only                                    |
| `POST` | `/api/v1/verification/results`                    | Agent only                                    |
| `POST` | `/api/webhooks/enode`                             | Enode → backend                               |

Full API surface: [`docs/api.md`](./api.md). Demo click-through:
[`docs/demo-runbook.md`](./demo-runbook.md).

## Public env (browser)

| Variable                            | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`              | Product name                                   |
| `NEXT_PUBLIC_APP_ENV`               | Public environment label                       |
| `NEXT_PUBLIC_API_BASE_URL`          | API base for `ApiClient`                       |
| `NEXT_PUBLIC_ARC_EXPLORER_BASE_URL` | Explorer links for txs                         |
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID`    | Web3Auth project (empty = onboarding disabled) |
| `NEXT_PUBLIC_WEB3AUTH_NETWORK`      | e.g. `sapphire_devnet`                         |

Validated in `src/config/env.ts`. Never put secrets in `NEXT_PUBLIC_*`.
