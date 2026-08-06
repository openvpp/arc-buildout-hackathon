#!/usr/bin/env bash
# Run on the DigitalOcean droplet after git fetch/reset (or after pull).
# Usage (from /opt/ev-telemetry): bash scripts/deploy-droplet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Deploying $(git rev-parse --short HEAD) in ${ROOT}"

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in ${ROOT}" >&2
  exit 1
fi

echo "==> Install dependencies"
corepack enable
pnpm install --frozen-lockfile

echo "==> Migrate database"
pnpm db:migrate

echo "==> Build"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
pnpm build

echo "==> Restart processes"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all --update-env
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
