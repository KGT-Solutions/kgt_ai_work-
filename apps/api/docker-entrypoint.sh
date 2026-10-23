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
# connection_limit is set explicitly because Prisma's default is
# (num_cpus * 2 + 1) PER PROCESS: with several API replicas on a many-core
# host that silently multiplies into more connections than Postgres will
# accept (max_connections, 100 by default), and the failure looks like random
# "too many clients" errors rather than a capacity problem.
export PRISMA_CONNECTION_LIMIT="${PRISMA_CONNECTION_LIMIT:-10}"
# Always target the compose Postgres service. A host-side DATABASE_URL
# (localhost:5440) from the env file is not reachable inside this container.
export DATABASE_URL="$(node -e '
const enc = encodeURIComponent;
const u = process.env.POSTGRES_USER;
const p = process.env.POSTGRES_PASSWORD;
const d = process.env.POSTGRES_DB;
const h = process.env.PGHOST;
const limit = encodeURIComponent(process.env.PRISMA_CONNECTION_LIMIT);
process.stdout.write("postgresql://" + enc(u) + ":" + enc(p) + "@" + h + ":5432/" + enc(d) + "?schema=public&connection_limit=" + limit);
')"

echo "[entrypoint] Waiting for Postgres at ${PGHOST} (db=${POSTGRES_DB} user=${POSTGRES_USER})..."
until pg_isready -h "${PGHOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] Postgres is ready."

# Exactly ONE container may migrate. Every API container used to run
# `prisma migrate deploy` on start, which is fine for one and a race for
# several: two replicas booting together would both try to apply the same
# migration, and the loser either errors or leaves the _prisma_migrations
# table in a failed state that blocks every later deploy.
#
# compose runs a one-shot `migrate` service with RUN_MIGRATIONS=true, and the
# API replicas wait for it to exit successfully with RUN_MIGRATIONS=false.
# Left defaulting to true so a single-container deployment, or anyone running
# this image by hand, behaves exactly as before.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying migrations..."
  npx prisma migrate deploy

  if [ "${RUN_SEED:-true}" = "true" ]; then
    echo "[entrypoint] Seeding (operator account; Flatbriz tenant unless SEED_FLATBRIZ_TENANT=false)..."
    node prisma/seed.js
  else
    echo "[entrypoint] Skipping seed (RUN_SEED=${RUN_SEED})."
  fi
else
  echo "[entrypoint] Skipping migrations and seed (RUN_MIGRATIONS=false; another container owns them)."
fi

echo "[entrypoint] Starting API..."
exec "$@"
