# Arc EV Fleet — hackathon accelerator milestone

A small, end-to-end flow on Arc testnet:

1. **Register/login** via a Circle developer-controlled wallet
   (Google-verified identity; wallet created and held server-side).
2. **Connect a vehicle** via Enode Link.
3. The device is **minted as a DeviceNFT on Arc testnet**, with accurate
   `unminted → pending → minted | failed` status tracking.
4. Devices with known coordinates appear as pins on a **Mapbox globe**.

See [CLAUDE.md](./CLAUDE.md) for the engineering contract, architecture
boundaries, and what is deliberately out of scope for this milestone.
See [docs/architecture.md](./docs/architecture.md) for the full request
flow, [docs/database.md](./docs/database.md) for the schema, and
[docs/demo-runbook.md](./docs/demo-runbook.md) to run the whole thing
end to end.

## Local setup

```bash
cp .env.example .env.local   # fill in Circle / Google / Enode / Arc / Mapbox values
pnpm install
pnpm services:up              # or point DATABASE_URL at an existing local Postgres
pnpm db:migrate
pnpm dev
```

In a second terminal, run the mint worker:

```bash
pnpm worker:dev
```

## Status

- [x] Repo scaffold (Next.js App Router, Postgres/Drizzle, lint/format/test
      tooling)
- [x] Circle developer-controlled wallet auth (Google-verified)
- [x] Enode device linking (pending-connection wizard + webhook)
- [x] Arc DeviceNFT minting (worker + claim-before-mint)
- [x] Mapbox device globe

All four are implemented and covered by unit/integration/e2e tests; the
live signed-in path (real Google/Circle/Enode/Arc/Mapbox credentials) is
not yet exercised in this environment — see
[docs/demo-runbook.md](./docs/demo-runbook.md#prerequisites).
