# Development guide

## Prerequisites

- **Node.js 24** (see `.nvmrc` / `.node-version`). With `nvm`: `nvm use`.
- **pnpm 11** via Corepack: `corepack enable`. The exact version is pinned by
  `packageManager` in `package.json`.

## Setup

```bash
corepack enable
pnpm install
pnpm dev            # http://localhost:3000
```

The app runs with zero configuration: `.env` ships committed public defaults.
To override locally, copy the example and edit the copy:

```bash
cp .env.example .env.local
```

`.env.local` is git-ignored. **Never** put secrets in `NEXT_PUBLIC_*` variables.
Server secrets (`DATABASE_URL`, `API_KEY_HASH_SECRET`, Enode/Arc credentials)
are validated by `src/server/config/env.ts` and documented in `.env.example`.

## Backend services

```bash
pnpm services:up       # Postgres + test Postgres
pnpm db:migrate
pnpm db:seed           # demo principal + API key (printed once)
pnpm worker:dev        # Enode webhook outbox processing
pnpm validate:backend  # includes integration tests (needs Postgres)
```

Optional Circle demo agent (dev/demo only — never put buyer keys in
`NEXT_PUBLIC_*`):

```bash
# set AGENT_API_BASE_URL, AGENT_API_KEY, AGENT_WALLET_ADDRESS, AGENT_DEVICE_ID
# and ARC_PAYMENT_SIGNER_PRIVATE_KEY (APP_ENV=development|demo|test only)
pnpm agent:dev
```

For settlement without live Circle funds locally: `ALLOW_MOCK_ADAPTERS=true`
(forbidden in production).

## Commands

```bash
pnpm dev            pnpm build          pnpm start
pnpm worker:dev     pnpm worker:start
pnpm agent:dev      pnpm agent:start
pnpm services:up    pnpm services:down  pnpm services:logs
pnpm db:generate    pnpm db:migrate     pnpm db:check  pnpm db:seed
pnpm lint           pnpm lint:fix
pnpm format         pnpm format:check
pnpm typecheck
pnpm test           pnpm test:unit      pnpm test:integration
pnpm test:backend   pnpm test:e2e
pnpm openapi:generate  pnpm openapi:check
pnpm validate       pnpm validate:backend
```

## Adding an environment variable

### Public (`NEXT_PUBLIC_*`)

1. Add it to `.env.example` and `.env`.
2. Add a field to `envSchema` in `src/config/env.ts`.
3. Read it in `readRawEnv()` using **static** `process.env.NEXT_PUBLIC_*` access.
4. Consume via `env`, never `process.env` directly.

### Server secrets

1. Document in `.env.example` (placeholder only).
2. Add to `serverEnvSchema` / `readRawServerEnv()` in `src/server/config/env.ts`.
3. Consume via `getServerEnv()` only.

## Branch workflow

- Branch off `main`: `git switch -c feat/<short-name>`.
- Keep changes small and focused (see the PR template).
- Open a PR to `main`; CI runs the full quality gate.

## Commit standards

[Conventional Commits](https://www.conventionalcommits.org/) enforced by
Commitlint on `commit-msg`. Allowed types:

```
feat  fix  refactor  test  docs  build  ci  chore  perf  revert
```

Example: `feat(telemetry): add provisional request-result schema`.

## Git hooks

Installed by Husky (`pnpm prepare`, run automatically after install):

- **pre-commit** → `lint-staged` (ESLint `--fix` + Prettier on staged files).
- **commit-msg** → Commitlint.

Hooks are intentionally fast. The full suite runs via `pnpm validate` and in CI,
not on every commit.

## Validation process

`pnpm validate` runs, in order:

```
format:check → lint → typecheck → test → build
```

Run `pnpm test:e2e` separately (it starts a dev server and drives Chromium).

## Troubleshooting

- **`pnpm typecheck` complains about missing Next types** — `typecheck` runs
  `next typegen` first, which regenerates `next-env.d.ts` and `.next/types`
  (including route types) so `tsc` can resolve them before any build. Both are
  generated and git-ignored; do not commit or hand-edit them.
- **ESLint: "process.env is restricted"** — read env via `src/config/env.ts`.
- **ESLint: "Do not call fetch directly here"** — use `src/lib/api`.
- **ESLint: "Import from a feature's public entry"** — import
  `@/features/<name>`, not its internal files.
- **Playwright: browser missing** — run
  `pnpm exec playwright install chromium`.
- **Corepack/pnpm version mismatch** — run `corepack enable` and re-run the
  command; the pinned version comes from `packageManager`.
- **Native build scripts blocked on install** — `sharp` and `unrs-resolver` are
  allow-listed in `pnpm-workspace.yaml`; run `pnpm install` again after enabling
  Corepack.

## Dependency auditing

Run `pnpm audit` periodically and before releases. CI does **not** fail on every
low-severity transitive advisory; triage findings and address ones that are
reachable and relevant. Keep dependencies minimal and justified.
