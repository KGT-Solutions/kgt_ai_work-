#!/bin/sh
set -e

echo "[entrypoint] Waiting for Postgres at ${PGHOST:-postgres}..."
until pg_isready -h "${PGHOST:-postgres}" -U "${POSTGRES_USER:-kgthub}" -d "${POSTGRES_DB:-kgthub}" >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] Postgres is ready."

echo "[entrypoint] Applying migrations..."
npx prisma migrate deploy

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] Seeding (operator account; demo tenant if SEED_DEMO_TENANT=true)..."
  node prisma/seed.js
else
  echo "[entrypoint] Skipping seed (RUN_SEED=${RUN_SEED})."
fi

echo "[entrypoint] Starting API..."
exec "$@"
