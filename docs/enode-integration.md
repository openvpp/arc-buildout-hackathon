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

Frontend: the "Add vehicle" popup (`DeviceOnboardModal`, opened from the
signed-in wallet dropdown — see `src/features/onboarding/`) starts the link;
`/enode/complete` is the Enode redirect target (nickname form → finalize).

## Webhook

```
POST /api/webhooks/enode
  → verify x-enode-signature (HMAC-SHA1, sha1=<hex>, over the raw body)
  → dedupe on x-enode-delivery (webhook_deliveries, unique per provider)
  → per event, in one transaction holding a row lock on the device
    (looked up by provider + external_device_id):
      → update devices.last_latitude/last_longitude from `location`
      → if the device is active:
          → `odometer.distance` (km) → odometer_readings + daily_odometer
          → `chargeState` → charging_sessions (start / update / close)
  → 202 accepted (500 if any event failed, so Enode redelivers)
```

Unknown event types are accepted and no-op'd, never treated as an error —
ingestion must not crash on an event type Enode adds later.

A delivery whose events failed is marked `failed` and is reprocessed when
Enode redelivers the same id; a `processed` delivery is still deduped. This is
safe because every per-event write is idempotent: readings are unique per
`(device, observed_at)`, and charge events older than the session's last
update (or the device's last closed session) are ignored as stale.

### Charging sessions

`chargeState.isCharging` drives the session: `true` opens one (or updates the
active one), `false` closes it. `null` (OEM doesn't report it) is ignored —
never guessed. Enode doesn't report delivered kWh for vehicles, so energy is
`(peak % − start %) × batteryCapacity`, where the peak is the highest level
seen during the session, and stored as
`energy_method = 'estimated_from_battery_change'`. The published end level is
the closing sample. A missing level on the opening update is filled from the
first sample that has one. A session whose battery level never rose is
`cancelled`; one without a usable capacity or level is `completed` with
`energy_method = 'unknown'`. Cost uses the configured
`ELECTRICITY_PRICE_USD_PER_KWH` tariff.

### Daily odometer

Readings are folded into one row per UTC day, rebuilt in time order so an
earlier reading that arrives late still becomes the start. A day chains to
the latest prior day's end, including across silent days, when the jump is
within 2,000 km per missing calendar day; otherwise it starts at its own
first reading (`start_estimated`). Readings below the day's start or past
that cap are counted in `anomaly_count` and ignored. A day is closed to new
readings once it is finalized **or** a later day has started (that day's
start is chained to this day's end, so changing it would count kilometres
twice); late readings for a closed day are stored raw only. Finalizing a day
rebuilds it once more before the on-chain payload is frozen.

The worker finalizes each day 30 minutes after its UTC midnight and queues
one `TRIP_COMPLETED` event per day. A day with under 0.1 mi of driving is
finalized but not published.

### Stale sessions

If Enode never sends the "stopped charging" update, a session with no
update for 24 hours is closed by the worker at its last update, using the
highest battery level stored. If charging resumes later, a new session opens.

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
