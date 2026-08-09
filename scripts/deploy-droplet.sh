#!/usr/bin/env bash
# Run on the DigitalOcean droplet after the tree is updated (CI rsync or git pull).
# Usage (from /opt/ev-telemetry): bash scripts/deploy-droplet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REV="$(git rev-parse --short HEAD 2>/dev/null || echo synced-tree)"
echo "==> Deploying ${REV} in ${ROOT}"

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in ${ROOT}" >&2
  exit 1
fi

# Serialize deploys on this host (overlapping CI runs / leftover builds).
mkdir -p "$ROOT/.deploy"
exec 9>"$ROOT/.deploy/deploy.lock"
echo "==> Acquiring deploy lock"
flock 9

# Next refuses to start if .next/lock exists from a crash or overlapping build.
if [[ -f "$ROOT/.next/lock" ]]; then
  echo "==> Clearing stale Next.js build lock (.next/lock)"
  rm -f "$ROOT/.next/lock"
fi

echo "==> Install dependencies"
corepack enable
pnpm install --frozen-lockfile

echo "==> Migrate database"
pnpm db:migrate

echo "==> Build"
# Droplet has limited RAM; always cap the Node heap for Next build.
NODE_OPTIONS=--max-old-space-size=1536 pnpm build

echo "==> Restart processes"
# Web must listen on 127.0.0.1 only (see package.json "start" -H). Cloudflare
# tunnel / Caddy proxy to loopback; do not expose :3000 on the public NIC.
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe web >/dev/null 2>&1; then
    pm2 restart web --update-env
  else
    pm2 start pnpm --name web -- start
  fi
  if pm2 describe worker >/dev/null 2>&1; then
    pm2 restart worker --update-env
  else
    pm2 start pnpm --name worker -- worker:start
  fi
  # Agent is optional (demo buyer); skip when not registered in pm2.
  if pm2 describe agent >/dev/null 2>&1; then
    pm2 restart agent --update-env
  else
    echo "==> Skipping agent restart (process not found)"
  fi
  pm2 save
  pm2 status
else
  echo "WARN: pm2 not found; start web/worker/agent manually" >&2
fi

echo "==> Health check"
sleep 2
curl -fsS -o /dev/null -w "GET / -> %{http_code}\n" http://127.0.0.1:3000/ || true
curl -fsS http://127.0.0.1:3000/api/readiness || true
echo
if command -v ss >/dev/null 2>&1; then
  echo "==> Listener check (expect 127.0.0.1:3000)"
  ss -lntp | grep ':3000' || true
fi
echo "==> Deploy complete"
