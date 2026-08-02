# Architecture

## Module boundaries & dependency direction

```
app/routes → features → shared (components, hooks, lib) → config / utilities
```

- **`src/app`** — Next.js App Router routes, layouts, and route-level
  `loading`/`error` boundaries. Thin: they compose features and components, and
  hold no business logic. Backend Route Handlers under `src/app/api` are
  transport-only.
- **`src/features/<name>`** — domain features (telemetry, verification, wallets,
  devices, dashboard). Each exposes a single public surface via `index.ts`.
- **`src/components`** — reusable, domain-agnostic UI (`ui/`), composed building
  blocks (`common/`), and app chrome (`layout/`).
- **`src/hooks`** — reusable client hooks.
- **`src/lib`** — frontend infrastructure: `api/` (typed client, errors, results),
  `query/` (TanStack Query), `logger/`, `utils/`.
- **`src/server`** — backend modular monolith (application, domain, infrastructure,
  transport). See [`backend-architecture.md`](./backend-architecture.md).
- **`src/agent`** — demo autonomous buyer process (server-side only).
- **`src/worker`** — outbox worker process.
- **`src/config`** — validated public `env` and static `site` config.
- **`src/types`** — branded ids and provisional domain models.
- **`src/providers`** — client provider composition root.

Enforced by ESLint: shared modules cannot import `features`; a feature cannot
import another feature's internals; `process.env` is restricted to
`src/config/env.ts` and `src/server/config/env.ts`; direct `fetch` is banned in
UI layers; domain/application cannot import Next.js/React.

## Server vs. Client Components

- **Server Components by default.** They render on the server, can be async, and
  keep bundle size down.
- Add **`'use client'`** only when a component needs browser state, event
  handlers, or browser APIs.
- Keep client boundaries as small and as low in the tree as possible.

## API boundary

- Frontend read access goes through `src/lib/api/client.ts` (`ApiClient`) or
  server-only loaders (`src/features/dashboard`).
- Dashboard telemetry reads use `createHttpTelemetryGateway` against device
  read APIs — the dashboard **never** pays.
- Agent purchase uses `POST /api/v1/agent/telemetry/latest` (Circle Gateway).
- `402 Payment Required` is an **expected domain response**, not a generic error.
- Responses are validated at runtime with schemas where applicable.

## Environment management

- `src/config/env.ts` validates **public** `NEXT_PUBLIC_*` vars at startup.
- `src/server/config/env.ts` validates **server** secrets/config lazily via
  `getServerEnv()` (database, API keys, Circle/Arc/Enode).
- Never put secrets in `NEXT_PUBLIC_*`. Production rejects mock adapters.
- `.env` holds committed public defaults; `.env.local` / process env hold server
  secrets locally.

## Backend (same repository)

See [`docs/backend-architecture.md`](./backend-architecture.md). Route Handlers
under `src/app/api` are transport-only; domain work lives in `src/server/**`.
Background jobs run in `src/worker`. The demo agent runs in `src/agent`.

## State management

- **Server state** → TanStack Query when client-side caching/polling is needed.
- **URL state** → filters, pagination, sorting, and shareable dashboard state.
- **Global client state** → avoided until a real cross-feature need exists.

## Error handling & observability

- Route-level `error.tsx`, a root `global-error.tsx`, and `not-found.tsx`.
- Frontend logger (`src/lib/logger`) with a swappable sink; backend uses Pino
  (`src/server/infrastructure/logging`) with redaction.
- User-facing errors are stable and generic (`ErrorState`); stack traces and
  internal details go to logs, never the UI.

## Testing strategy

- **Vitest + React Testing Library + jsdom** for unit and component tests.
- **PostgreSQL integration tests** under `test/integration` (Docker Compose /
  CI service), including Circle facilitator **test doubles**.
- **Playwright** (Chromium) for critical-journey smoke tests.
- Network boundaries are mocked; tests never touch real wallets/Enode/Circle
  funds in CI.

## Security

See [`docs/security.md`](./security.md) and `README.md`. Highlights: no secrets
in the frontend, production rejects mocks, Circle settle before delivery,
schema validation, conservative security headers in `next.config.ts`.

## Done vs deferred

**Implemented in this monorepo:**

- Enode webhook ingestion + telemetry normalization + content hash
- Agent latest-telemetry + Circle Gateway HTTP `402` settle path
- Ledger credit + delivery + cursor after successful settle
- Demo agent Arc settlement receipt + content-hash verification
- Dashboard read APIs + multi-wallet/device UI wiring

**Still deferred:**

- BatchAnchor provenance + enforced `PROVENANCE_DELIVERY_MODE=strict`
- Live Enode HTTP API client sync
- Production KMS buyer signing
- Rate limiting mounted on agent routes
- Separate BE/FE repositories
- A concrete `Content-Security-Policy` once origins are finalized
