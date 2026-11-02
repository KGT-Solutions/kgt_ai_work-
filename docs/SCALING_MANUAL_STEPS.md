# Scaling changes — what you must do by hand

All five phases are **complete and verified**. This file lists only what code
cannot do for itself: your own config files, and the decisions that are yours.

Verified by both halves of the release gate:

| Gate | Result |
|---|---|
| `docker-compose.test.yml` (unit + integration + db + system, sealed network, **both store drivers**) | **577 pass, 0 fail**, exit 0 |
| `docker-compose.e2e.yml` (Playwright, 5 journeys) | **5 passed**, exit 0 |

Plus a live two-replica stack, brought up on spare ports against a throwaway
volume, to prove the things only a running system can show — see
[§6](#6-what-was-proved-on-a-live-stack). Nothing is committed.

---

## 1. Required — raise the chat limit

`.env.docker` line 39 pins the old value, and **an env file always beats the
code default**, so none of the Phase 5 work reaches your deployment until you
change it. At 30 requests / 10 minutes an entire company's website shares ~3
messages a minute, and the dashboard's own test chat draws from the same bucket.

```diff
-TENANT_CHAT_RATE_LIMIT_MAX=30
+TENANT_CHAT_RATE_LIMIT_MAX=300
```

`.env.docker` is untracked and holds your secrets, so I did not touch it.
Compare it against `.env.docker.example`, which documents every new knob.

## 2. Required — check `TRUST_PROXY_HOPS` before you deploy the load balancer

This is the one that will bite quietly. Adding nginx in front of the API adds a
hop, and `req.ip` — which **every per-IP rate limit** depends on — is read from
the `X-Forwarded-For` chain. Get it wrong and there is no error: either all
visitors share one bucket, or a visitor can spoof the header for a fresh bucket
per request.

Both values below are empirically verified against the real stack:

| Your topology | Value | Verified result |
|---|---|---|
| visitor → nginx → api | **1** | two visitors got two separate buckets (`rl:client-login:172.22.0.4`, `…0.5`) |
| visitor → your TLS terminator → nginx → api | **2** | two real visitors got two separate buckets on `ai.kgt.solutions` |

**`ai.kgt.solutions` is the second case, and is set to `2`.** Its chain is
`visitor → host Nginx (TLS, ai-hub.conf) → 127.0.0.1:4100 → compose nginx → api`,
and both proxies append to `X-Forwarded-For`. Verified live: requests from two
different machines produced two distinct buckets. At `1` they both collapse
onto an internal Docker address and **every visitor on the platform shares one
rate limit** — no error, just a limit that fires far too early.

Counting rule: it is the number of proxies that append to `X-Forwarded-For`,
and a value that is too high is as bad as too low (a visitor can then spoof the
header for a fresh bucket). Don't infer it from a `curl` run **on the server** —
hairpinning through the public IP adds a hop and gives a misleading answer.

Your `.env.docker` does not set it, so the code default of **1** applies. Your
`CORS_ORIGINS` points at a real domain and `DEPLOY_ENV=production`, which
suggests something already terminates TLS in front of the API — **if so you
need `TRUST_PROXY_HOPS=2`.** Confirm rather than guess:

```bash
# through your real public entrypoint, twice with different visitor addresses
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://YOUR-API/api/v1/client/login \
  -H 'Content-Type: application/json' -H 'X-Forwarded-For: 203.0.113.1' \
  -d '{"email":"x@y.test","password":"wrong"}'
# ...repeat 12x with 203.0.113.1, then 12x with 203.0.113.2.
# Right value: each address gets its own 10 attempts before any 429.
# Wrong value: the second address is already limited.
```

## 2b. Required if you have a `docker-compose.override.yml`

**This bites on the first deploy.** An override that publishes the **`api`**
service on a fixed host port is incompatible with replicas: one replica takes
the port and the rest die with

```
Error response from daemon: ... Bind for 127.0.0.1:4100 failed: port is already allocated
```

nginx is the stack's entry point now, so the host-port publish belongs on
**`nginx`** (container port **80**, not the API's 4000). On `ai.kgt.solutions`
the override was:

```diff
 services:
   postgres:
     ports: !override
       - "127.0.0.1:${POSTGRES_PORT:-5440}:5432"
-  api:
-    ports: !override
-      - "127.0.0.1:${API_PORT:-4100}:4000"
+  nginx:
+    ports: !override
+      - "127.0.0.1:${API_PORT:-4100}:80"
   web:
     ports: !override
       - "127.0.0.1:${WEB_PORT:-3110}:3001"
```

Your host Nginx keeps proxying to `${API_PORT}` exactly as before — this only
changes which container answers there. Keep the `127.0.0.1:` prefix: without
it the replicas' entry point would bind `0.0.0.0` and expose the API publicly,
bypassing your TLS terminator.

## 3. Required — apply the new migration

One additive migration adds `ChatSession.summaryClaimedAt` (one nullable
column, no backfill), so it is safe on a live database. The new one-shot
`migrate` service applies it:

```bash
docker compose --env-file .env.docker up -d --build
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c '\d "ChatSession"' | grep summaryClaimedAt
```

## 4. Nothing else is required to turn on multi-instance

Your existing `.env.docker` already works. `docker-compose.yml` defaults
`API_REPLICAS=2`, `SHARED_STORE=redis` and `REDIS_URL=redis://redis:6379`, so a
plain `up -d --build` gives you Redis, two API replicas and nginx. That
defaulting is deliberate: shipping 2 replicas while leaving `SHARED_STORE` to
an older env file would have run two containers each keeping their own state —
the exact broken configuration this work exists to prevent, and it fails
silently.

To go back to one container: `API_REPLICAS=1` and `SHARED_STORE=memory`.
Nothing else changes.

What changed in the topology:

| | Before | Now |
|---|---|---|
| Host port 4100 | the API container | nginx, which balances the replicas |
| API containers | 1, named `kgt-ai-hub-api` | `API_REPLICAS` (2), unnamed — a fixed name and a host port both conflict with replicas |
| Migrations | every API container on start (a race with 2+) | one-shot `migrate` service; replicas wait for it and skip |
| Postgres connections | Prisma default, `num_cpus * 2 + 1` per process, unset | `PRISMA_CONNECTION_LIMIT=10` per replica — budget `API_REPLICAS × 10 + 1` under `max_connections` |

## 5. Decisions for you

**`ioredis@5.9.1` is a new runtime dependency** — the first added for
infrastructure rather than a feature, in a repo that deliberately avoids SDKs
(`engine/llmClient.js` talks to three LLM providers with built-in `fetch`). I
chose a real client because a sliding-window limiter must be atomic, and
reconnection and error classification are where a hand-rolled Redis client goes
quietly wrong — a limiter that silently stops counting costs money invisibly.
It is inert unless `SHARED_STORE=redis`. Say the word and I will revert it;
Phases 1, 2, 3 and 5 do not need it.

**Raise Docker's memory.** Yours has ~4.1 GB, which is what crashed the daemon
mid-build earlier (`rpc error … EOF`) and is tight for two replicas plus Redis
plus nginx plus Postgres. Docker Desktop → Settings → Resources → Memory: 8 GB.

**Redis persistence and backup.** `appendonly yes` with a named volume is
configured. Only the per-tenant knowledge generation matters across a restart,
and losing it is safe-but-slower (every instance treats its caches as stale and
re-reads Postgres), so Redis does not need to go into your backup rotation —
but it does need monitoring, since the degraded modes below are silent to users.

## 6. What was proved on a live stack

Brought up as an isolated compose project on spare ports against a throwaway
volume, so your real data was never involved:

- **Both replicas booted with the shared driver** — `[sharedStore] shared via redis — safe to run several API containers`.
- **Migrations ran exactly once.** The `migrate` container applied all 15 and exited; both replicas logged `Skipping migrations and seed (RUN_MIGRATIONS=false; another container owns them)`.
- **nginx balances both replicas.** A 12-request burst split **5/5** between them — confirming the `proxy_pass` via a variable actually re-resolves, instead of pinning to whichever replica answered DNS first (a static `upstream` block would have).
- **Rate limits are genuinely shared.** That same burst from one visitor hit the limit at the 10th attempt (`401 ×10, 429, 429`) *despite being served by two different containers*. Unshared it would have taken 20 — this is the bug, in reverse.
- **Per-visitor bucketing survives the load balancer** — two source addresses produced two separate Redis keys.

Not proved end-to-end on a live stack: cross-instance **knowledge
invalidation**. It is covered at two test layers instead — an integration test
where an edit on one cache instance invalidates another's, and the Redis
contract suite proving the counter semantics it relies on.

## 7. Known behaviour once Redis is on

Failure policy is per operation, by design
(`apps/api/src/lib/sharedStore/redisDriver.js`):

- **Rate limits fail OPEN** — a Redis blip must not take every tenant's widget
  offline. Your provider quota remains the backstop. Logged loudly.
- **Caches are bypassed** — a generation read returns `NaN`, which matches
  nothing, so reads go to Postgres and nothing cached is trusted. Chat stays
  correct and gets slower, rather than serving content from documents that have
  since changed.
- **Background job locks fail CLOSED** — skipping an audit is cheap and it
  retries; running it on every instance at once is a duplicated bill.

Change these if your priorities differ — they are deliberate trade-offs.

---

## 8. Things to know (no action needed)

**Two test-harness bugs fixed**, both of which were hiding real failures:

- `test/support/realStack.js` *deleted* `DEPLOY_ENV`, then `app.js`'s
  `dotenv.config()` put `DEPLOY_ENV=production` straight back from your local
  `apps/api/.env` (dotenv only skips keys that still exist). The whole suite ran
  in production mode, so the mailer reported every send as failed.
- `test/system/rateLimits.test.js` asserted an exact cut-off of 30 without
  pinning the env var, so it silently inherited your `.env`. That is why it
  passed locally and failed in Docker.

**`createIpRateLimiter` now requires a unique `name`.** All 17 limiters share
one keyspace, so an unnamed one would collide — sign-in attempts would eat into
the signup-code allowance for the same IP. It throws rather than colliding
silently.

**Chunks must never be edited in place.** The per-chunk retrieval index is keyed
on the chunk object, which is safe only because `documentChunks()` always builds
new objects. A test pins that contract.

**Three missing dependencies** (`nodemailer`, `mammoth`, `yazl`) were declared
but absent from your local `node_modules`, so 7 test files could not load.
`npm ci` fixed it; `package.json` and `package-lock.json` were not edited by it.

**Verify any of it yourself:**

```bash
cd apps/api && npm test                 # 505 tests, no database, ~20s
npm run bench                           # retrieval cost

# both gates (needs Docker)
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from api-tests
docker compose -f docker-compose.e2e.yml  up --build --abort-on-container-exit --exit-code-from e2e

# a live two-replica stack on spare ports, nothing of yours touched
API_PORT=4199 POSTGRES_PORT=5499 docker compose -p kgtp4 --env-file .env.docker up -d --build nginx
docker compose -p kgtp4 logs api | grep sharedStore
API_PORT=4199 POSTGRES_PORT=5499 docker compose -p kgtp4 --env-file .env.docker down -v
```
