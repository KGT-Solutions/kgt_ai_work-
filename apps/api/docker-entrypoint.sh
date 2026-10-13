#!/bin/sh
set -e

# Credentials come from the container env_file (.env.docker), not from
# compose interpolation. A plain `docker compose up` would otherwise
# override POSTGRES_PASSWORD with the default "kgthub" and fail migrate
# against a volume that was initialized with the real password.
export PGHOST="${PGHOST:-postgres}"
export POSTGRES_USER="${POSTGRES_USER:-kgthub}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-kgthub}"
export POSTGRES_DB="${POSTGRES_DB:-kgthub}"
# Always target the compose Postgres service. A host-side DATABASE_URL
# (localhost:5440) from the env file is not reachable inside this container.
export DATABASE_URL="$(node -e '
const enc = encodeURIComponent;
const u = process.env.POSTGRES_USER;
const p = process.env.POSTGRES_PASSWORD;
const d = process.env.POSTGRES_DB;
const h = process.env.PGHOST;
process.stdout.write("postgresql://" + enc(u) + ":" + enc(p) + "@" + h + ":5432/" + enc(d) + "?schema=public");
')"

echo "[entrypoint] Waiting for Postgres at ${PGHOST} (db=${POSTGRES_DB} user=${POSTGRES_USER})..."
until pg_isready -h "${PGHOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] Postgres is ready."

echo "[entrypoint] Applying migrations..."
npx prisma migrate deploy

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] Seeding (operator account; Flatbriz tenant unless SEED_FLATBRIZ_TENANT=false)..."
  node prisma/seed.js
else
  echo "[entrypoint] Skipping seed (RUN_SEED=${RUN_SEED})."
fi

echo "[entrypoint] Starting API..."
exec "$@"
