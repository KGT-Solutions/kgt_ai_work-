#!/bin/sh
# Healthcheck for the `backup` sidecar. Makes a stalled backup VISIBLE: the
# container is reported unhealthy by `docker ps` (and any container monitor) when
# no completed dump exists within the freshness window. This is the passive
# counterpart to BACKUP_ALERT_CMD — it catches the case where the loop itself is
# wedged or the container keeps restarting before it can dump.
#
#   BACKUP_HEALTH_MAX_AGE_HOURS   Unhealthy if the newest dump is older.  [default 26]
#
# Notes:
#   - BACKUP_ENABLED=false -> always healthy (backups are intentionally off).
#   - With BACKUP_ON_START=false and no dump yet, the container reports unhealthy
#     until the first scheduled dump lands. That is honest (there is no recent
#     backup); give the healthcheck a long start_period in that mode.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"

case "$(echo "${BACKUP_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')" in
  false) exit 0 ;;
esac

max_h="${BACKUP_HEALTH_MAX_AGE_HOURS:-26}"
case "$max_h" in ''|*[!0-9]*) max_h=26 ;; esac
mins=$(( max_h * 60 ))

if find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kgthub_*.dump' -mmin "-$mins" 2>/dev/null | grep -q .; then
  exit 0
fi

echo "[backup-health] no completed dump in $BACKUP_DIR newer than ${max_h}h"
exit 1
