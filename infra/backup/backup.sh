#!/bin/sh
# Scheduled Postgres backup loop for the `backup` sidecar in docker-compose.yml.
#
# Runs inside a pgvector/pgvector:pg16 container (same image as the DB, so the
# pg_dump client version matches the server exactly). It takes a compressed
# custom-format dump of the whole database once a day, prunes dumps older than
# the retention window, and — if configured — hands each fresh dump to an
# offsite command. Everything is logged with a [backup] prefix so it reads like
# the rest of the stack in `docker logs`.
#
# Why a loop rather than cron: no cron daemon in the base image, and a tiny
# shell loop is easier to reason about and surfaces its state in the container
# logs. The container's restart policy covers a crash; the loop covers the
# schedule.
#
# Visibility: a backup that fails silently is almost as bad as none, so failures
# are (a) logged, (b) sent to BACKUP_ALERT_CMD if set, and (c) made visible to
# `docker ps` via healthcheck.sh, which goes unhealthy when no recent dump exists.
#
# Config (all from the compose env_file / environment):
#   BACKUP_ENABLED          "false" disables the sidecar entirely (it idles).   [default true]
#   BACKUP_HOUR_UTC         Hour of day (UTC, 0-23) to run the daily dump.      [default 2]
#   BACKUP_RETENTION_DAYS   Delete local dumps older than this many days.       [default 14]
#   BACKUP_ON_START         Take one dump immediately on container start too.   [default true]
#   BACKUP_DIR              Where dumps are written (a mounted volume).         [default /backups]
#   BACKUP_OFFSITE_CMD      Optional: run per dump as `sh -c "$CMD" offsite <dump-path>`.
#   BACKUP_ALERT_CMD        Optional: run on failure as `sh -c "$CMD" alert <message>`.
#   PGHOST / POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD   DB connection.
#
# A dump is written to a .part file first and renamed only on success, so a
# crash mid-dump never leaves a truncated file that looks like a good backup.

set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
PGHOST="${PGHOST:-postgres}"
DB_USER="${POSTGRES_USER:-kgthub}"
DB_NAME="${POSTGRES_DB:-kgthub}"
BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-2}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_ON_START="${BACKUP_ON_START:-true}"
BACKUP_ENABLED="${BACKUP_ENABLED:-true}"

# pg_dump reads the password from PGPASSWORD; POSTGRES_PASSWORD comes from the
# shared env_file. Not echoed anywhere, and scrubbed from the environment of the
# offsite/alert hooks below so an operator's command can't accidentally leak it.
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

log() { echo "[backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

# Lower-case a value without relying on bash ${x,,}.
lc() { echo "$1" | tr '[:upper:]' '[:lower:]'; }

if [ "$(lc "$BACKUP_ENABLED")" = "false" ]; then
  log "BACKUP_ENABLED=false — sidecar idle, taking no backups."
  # Idle forever so the container stays up (restart:unless-stopped) without churning.
  while true; do sleep 86400; done
fi

# Validate the configured hour ONCE at startup. Strip leading zeros first so
# test/arithmetic never read "08"/"09" as a bad octal literal; fall back to 2 on
# anything non-numeric or out of range, so a typo can never make the schedule
# loop spin (an un-parseable hour would otherwise break seconds_until_run).
BACKUP_HOUR_UTC="$(printf '%s' "$BACKUP_HOUR_UTC" | sed 's/^0*//')"
BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-0}"
case "$BACKUP_HOUR_UTC" in
  ''|*[!0-9]*)
    log "WARNING: BACKUP_HOUR_UTC is not a valid number — falling back to 2."
    BACKUP_HOUR_UTC=2 ;;
  *)
    if [ "$BACKUP_HOUR_UTC" -gt 23 ]; then
      log "WARNING: BACKUP_HOUR_UTC=$BACKUP_HOUR_UTC is out of range (0-23) — falling back to 2."
      BACKUP_HOUR_UTC=2
    fi ;;
esac

mkdir -p "$BACKUP_DIR"

# Run an operator hook ($cmd) with a verb and one argument, in a subshell that
# cannot see PGPASSWORD. Used for both the offsite copy and the failure alert.
run_hook() {
  verb="$1"; cmd="$2"; arg="$3"
  ( unset PGPASSWORD; sh -c "$cmd" "$verb" "$arg" )
}

# Optional offsite push. The command is run with the dump path as $1; e.g.
#   BACKUP_OFFSITE_CMD='aws s3 cp "$1" s3://my-bucket/kgt/'
offsite() {
  dump="$1"
  cmd="${BACKUP_OFFSITE_CMD:-}"
  [ -z "$cmd" ] && return 0
  log "offsite: running configured BACKUP_OFFSITE_CMD"
  if run_hook offsite "$cmd" "$dump"; then
    log "offsite OK: $dump"
  else
    log "ERROR: offsite command failed for $dump (kept locally)."
    alert "offsite copy failed for $dump"
  fi
}

# Optional failure alert. The command is run with the message as $1; e.g.
#   BACKUP_ALERT_CMD='curl -fsS -X POST -d "text=$1" https://hooks.example/...'
alert() {
  msg="$1"
  cmd="${BACKUP_ALERT_CMD:-}"
  [ -z "$cmd" ] && return 0
  log "alert: running configured BACKUP_ALERT_CMD"
  run_hook alert "$cmd" "KGT backup: $msg" || log "ERROR: alert command itself failed."
}

# Delete local dumps older than the retention window, and stale partial files
# left by a crashed dump. Only ever touches our own files, maxdepth 1, so it can
# never remove anything else in the volume. Runs after both success and failure
# so a disk-full condition can reclaim space and self-heal.
prune() {
  days="$BACKUP_RETENTION_DAYS"
  case "$days" in
    ''|*[!0-9]*) log "prune: BACKUP_RETENTION_DAYS='$days' is not a number — skipping age-based prune." ;;
    *)
      removed="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kgthub_*.dump' -mtime "+$days" -print -delete 2>/dev/null | wc -l)"
      [ "$removed" -gt 0 ] && log "pruned $removed dump(s) older than ${days} day(s)." ;;
  esac
  # Stale .part files from crashed dumps (>1 day old; never the current one,
  # which is already renamed or removed by the time prune runs).
  parts="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'kgthub_*.dump.part' -mtime +0 -print -delete 2>/dev/null | wc -l)"
  [ "$parts" -gt 0 ] && log "cleaned $parts stale partial dump(s)."
  return 0
}

# Take one dump. Returns 0 on success, non-zero on failure (never exits the script).
run_backup() {
  ts="$(date -u '+%Y-%m-%d_%H%M%S')"
  final="$BACKUP_DIR/kgthub_${ts}.dump"
  part="$final.part"

  log "starting dump of '$DB_NAME' on '$PGHOST' -> $final"
  if pg_dump -h "$PGHOST" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$part"; then
    mv "$part" "$final"
    size="$(wc -c < "$final" 2>/dev/null || echo '?')"
    log "dump OK ($size bytes): $final"
    offsite "$final"
    prune
    return 0
  else
    rc=$?
    log "ERROR: pg_dump failed (exit $rc) — removing partial file."
    rm -f "$part"
    # Reclaim space even on failure, so a full disk can recover on its own.
    prune
    alert "pg_dump failed (exit $rc) for '$DB_NAME' on '$PGHOST'"
    return "$rc"
  fi
}

# Seconds from now until the next BACKUP_HOUR_UTC:00 (UTC). Uses GNU date's
# %-H/%-M/%-S (no leading zeros) so POSIX arithmetic never reads "08"/"09" as a
# bad octal literal. BACKUP_HOUR_UTC is already a validated 0-23 integer.
seconds_until_run() {
  now_h="$(date -u +%-H)"; now_m="$(date -u +%-M)"; now_s="$(date -u +%-S)"
  now_secs=$(( now_h * 3600 + now_m * 60 + now_s ))
  target_secs=$(( BACKUP_HOUR_UTC * 3600 ))
  diff=$(( target_secs - now_secs ))
  [ "$diff" -le 0 ] && diff=$(( diff + 86400 ))
  echo "$diff"
}

log "backup sidecar started — daily at ${BACKUP_HOUR_UTC}:00 UTC, retention ${BACKUP_RETENTION_DAYS}d, dir ${BACKUP_DIR}"

if [ "$(lc "$BACKUP_ON_START")" = "true" ]; then
  log "BACKUP_ON_START=true — taking an initial backup now."
  run_backup || log "initial backup failed; will retry on the daily schedule."
fi

while true; do
  wait_s="$(seconds_until_run)"
  log "next scheduled backup in ${wait_s}s (at ${BACKUP_HOUR_UTC}:00 UTC)."
  sleep "$wait_s"
  run_backup || log "scheduled backup failed; will retry at the next window."
done
