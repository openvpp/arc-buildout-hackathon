# Enode integration

## Vehicle onboarding (Enode Link)

| Method | Path                                                         | Purpose                                       |
| ------ | ------------------------------------------------------------ | --------------------------------------------- |
| `POST` | `/api/v1/vehicle-onboarding/link`                            | Create a pending connection + Enode `linkUrl` |
| `GET`  | `/api/v1/vehicle-onboarding/oauth/enode-complete?pendingId=` | After the OEM redirect                        |
| `GET`  | `/api/v1/vehicle-onboarding/pending/:id`                     | Poll wizard status                            |
| `POST` | `/api/v1/vehicle-onboarding/pending/:id/complete`            | Persist `devices` + enqueue mint              |

Auth: the httpOnly dashboard session cookie (set by
`POST /api/v1/dashboard/session`) — no separate bearer token. The wallet id
used for every onboarding call comes from the verified session, never from
the request body.

Frontend: `/devices/onboard` starts the link; `/enode/complete` is the
Enode redirect target (nickname form → finalize).

## Webhook

```
POST /api/webhooks/enode
  → verify x-enode-signature (HMAC-SHA1, sha1=<hex>, over the raw body)
  → dedupe on x-enode-delivery (webhook_deliveries, unique per provider)
  → update devices.last_latitude/last_longitude on user:vehicle:updated /
    user:vehicle:discovered with a location payload
  → 202 accepted
```

Unknown event types are accepted and no-op'd, never treated as an error —
ingestion must not crash on an event type Enode adds later.

## Known gap this deliberately avoids

An earlier Enode integration researched during planning scoped
disconnect/relink by wallet/user id alone, which meant unlinking one vendor
could deactivate a user's unrelated devices, and never persisted vehicle
identity at all (so nothing prevented a duplicate link). This
implementation keys `devices` by `(provider, external_device_id)`
specifically to rule both of those out — see the unique index in
[`docs/database.md`](./database.md) and `finalize-pending.ts`.

## Env

See `.env.example` for the full list (`ENODE_API_BASE_URL`,
`ENODE_OAUTH_TOKEN_URL`, `ENODE_CLIENT_ID`/`ENODE_CLIENT_SECRET`,
`ENODE_REDIRECT_URI`, `ENODE_WEBHOOK_SECRET`,
`PENDING_DEVICE_OAUTH_TTL_HOURS`). Register `ENODE_REDIRECT_URI` in the
Enode developer console for whichever environment you're pointing at.
