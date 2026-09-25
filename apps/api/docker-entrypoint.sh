#!/bin/sh
set -e

echo "[entrypoint] Waiting for Postgres at ${PGHOST:-postgres}..."
until pg_isready -h "${PGHOST:-postgres}" -U "${POSTGRES_USER:-society}" -d "${POSTGRES_DB:-society}" >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] Postgres is ready."

echo "[entrypoint] Generating Prisma client..."
npx prisma generate

echo "[entrypoint] Applying migrations..."
if ! npx prisma migrate deploy; then
  echo "[entrypoint] migrate deploy failed. Existing Postgres volume may already have tables."
  echo "[entrypoint] Marking baseline as applied, then retrying remaining migrations..."
  npx prisma migrate resolve --applied 20260820120000_postgres_baseline 2>/dev/null || true
  npx prisma migrate deploy
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding database..."
  node prisma/seed.js || true
else
  echo "[entrypoint] Skipping seed (RUN_SEED=${RUN_SEED:-false})."
fi

echo "[entrypoint] Starting API..."
exec "$@"
