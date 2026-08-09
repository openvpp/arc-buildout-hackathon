#!/usr/bin/env bash
# Nightly (or on-demand) Postgres dump for the droplet.
# Usage: bash scripts/backup-postgres.sh
# Cron example (root): 15 3 * * * /opt/ev-telemetry/scripts/backup-postgres.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ev-telemetry}"
LOG_FILE="${LOG_FILE:-/var/log/ev-telemetry-backup.log}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
CONTAINER="${POSTGRES_CONTAINER:-ev-telemetry-postgres}"
DB_NAME="${POSTGRES_DB:-ev_telemetry}"
DB_USER="${POSTGRES_USER:-postgres}"

mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

if ! command -v docker >/dev/null 2>&1; then
  log "ERROR: docker not found"
  exit 1
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  log "ERROR: container $CONTAINER not found"
  exit 1
fi

stamp="$(date -u +%Y%m%d-%H%M)"
outfile="${BACKUP_DIR}/ev_telemetry-${stamp}.dump"

log "Starting backup → ${outfile}"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc >"$outfile"
size="$(wc -c <"$outfile" | tr -d ' ')"
if [[ "$size" -lt 100 ]]; then
  log "ERROR: dump looks empty (${size} bytes); removing"
  rm -f "$outfile"
  exit 1
fi
log "Backup ok size=${size} bytes"

deleted="$(find "$BACKUP_DIR" -type f -name 'ev_telemetry-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')"
log "Retention: removed ${deleted} dump(s) older than ${RETENTION_DAYS} day(s)"

# Optional: list dump TOC (dry-run integrity check)
if docker exec "$CONTAINER" which pg_restore >/dev/null 2>&1; then
  if docker exec -i "$CONTAINER" pg_restore -l <"$outfile" >/dev/null; then
    log "pg_restore -l ok"
  else
    log "WARN: pg_restore -l failed (file kept for investigation)"
  fi
fi

log "Done"
