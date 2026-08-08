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
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart web --update-env
  pm2 restart worker --update-env
  pm2 restart agent --update-env
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
echo "==> Deploy complete"
