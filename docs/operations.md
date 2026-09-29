# Operations

Deploy notes for this milestone. External accounts (Circle, Enode, Arc,
Mapbox) are still required; this app does not replace them.

## What has to be true before traffic

- `APP_ENV=production` (or `staging`).
- `ALLOW_MOCK_ADAPTERS=false`. Startup refuses `true` in those environments.
- `API_KEY_HASH_SECRET` is at least 32 random characters. It signs the
  `ev_dashboard_session` cookie. Rotating it signs every current session out.
- `DATABASE_URL` points at Postgres with `DATABASE_SSL_MODE=require` when the
  database is not on localhost.
- Circle, Enode, and the Arc minter key are set only on the server and the
  worker. `NEXT_PUBLIC_*` values are the Mapbox token, the Arc explorer base
  URL, and the optional Google client id.
- The mint worker (`pnpm worker:dev` locally, the same `src/worker/index.ts`
  process in production) is running. Mints do not happen inside HTTP requests.
- Enode's webhook target is a public `POST /api/webhooks/enode`, and
  `ENODE_WEBHOOK_SECRET` matches the Enode console. Unsigned deliveries are
  rejected.

## Migrations

```bash
pnpm db:migrate
```

Apply migrations before starting the app version that expects them. The
current extra migration adds:

- `outbox_events.locked_at` (nullable)
- a partial unique index so a device has at most one active mint job
- an index for the public globe location query

If the unique index fails, two `pending` or `processing` mint jobs exist for
the same device. Keep one, delete or complete the other, and run migrate
again. Do not edit an already-applied SQL file.

## Rollback

1. Stop the new app and worker.
2. Start the previous app and worker.
3. Leave the new column and indexes in place. The previous code does not
   read `locked_at`. Dropping the column while the new worker is still
   running will crash job claims.

The session cookie format did not change. A deploy does not, by itself,
sign users out.

## Health

| Path                    | Meaning                                               |
| ----------------------- | ----------------------------------------------------- |
| `GET /api/health`       | Process is up. Does not touch Postgres.               |
| `GET /api/health/ready` | Postgres answered `select 1`. Use this for readiness. |

## Limits that are in the app

- Session creation, vehicle link, and finalize are rate limited in process
  memory (per instance, not across a fleet of servers). Put a shared limiter
  in front if you run more than one web process.
- JSON bodies are capped at 16 KiB. Enode webhook bodies are capped at 256 KiB.
- The globe loads located devices in pages of 200, up to 25 pages per refresh.

## Still external

Circle wallet creation, Enode Link, Arc RPC, and Mapbox are live dependencies.
A missing Circle or Enode credential fails that action with a client-safe
error; it does not fall back to a fake wallet or a fake mint. The email used
at sign-in is still self-asserted. That is an intentional property of this
milestone, described in `bind-dashboard-owner.ts`, not an unfinished OAuth
integration.
