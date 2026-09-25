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
- [ ] Circle developer-controlled wallet auth
- [ ] Enode device linking
- [ ] Arc DeviceNFT minting
- [ ] Mapbox device globe
