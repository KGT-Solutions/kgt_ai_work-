# Operations Runbook

For whoever is on call. Routine checks, incident procedures, and the
tenant-lifecycle operations KGT staff perform.

Deployment and environment variables are documented in §6 of
[DOCUMENTATION.md](../DOCUMENTATION.md); this runbook is what to *do*, in order,
when something needs doing.

All commands assume the Docker deployment and container names `kgt-ai-hub-api`,
`kgt-ai-hub-web`, `kgt-ai-hub-postgres`.

---

## 1. Health at a glance

```bash
# everything up and healthy?
docker ps --filter name=kgt-ai-hub

# API alive?
curl -fsS http://localhost:4100/health      # {"status":"ok"}

# how did it start?
docker logs kgt-ai-hub-api 2>&1 | grep -E "\[(startup|llm|mailer|leads)\]"

# crash looping?
docker inspect -f '{{.RestartCount}}' kgt-ai-hub-api
```

A healthy boot looks like this:

```
[llm] groq: model "llama-3.3-70b-versatile" is available
[mailer] sending via smtp (SMTP login OK) as bots@yourcompany.com
KGT AI Hub API running at http://localhost:4000
```

Anything else in those four prefixes is the answer to most incidents.

### Log prefixes

| Prefix | Covers |
|---|---|
| `[startup]` | production safety checks; a `FATAL` here means the API refused to boot |
| `[llm]` | provider chain: model availability, fail-over, degraded answers |
| `[mailer]` | transport setup and send failures, each with a reason and a fix |
| `[leads]` | lead confirmation emails, one line per lead |
| `[register]` | signup refusals, with a masked address and the reason |
| `[botAuditor]` | readiness audits falling back to the heuristic |
| `[tenantFaqs]` | starter-question generation |
| `[entrypoint]` | container boot sequence and migrations |

---

## 2. Routine checks

### Daily (2 minutes)

- [ ] `docker ps` — all three containers healthy, restart counts unchanged
- [ ] `curl -fsS .../health` returns ok
- [ ] `docker logs --since 24h kgt-ai-hub-api 2>&1 | grep -c "LLM unavailable"` — a
      non-zero count means customers got degraded answers
- [ ] `docker logs --since 24h kgt-ai-hub-api 2>&1 | grep "\[mailer\] ERROR"` — empty

### Weekly

- [ ] A backup from the last 24 h exists and is non-trivial in size
- [ ] Disk headroom on the Postgres volume
- [ ] Spot-check one tenant's usage page for an unexplained jump
- [ ] Review tenants sitting at **Not Ready** — they are the churn risk

### Monthly

- [ ] Restore the latest dump into a scratch database and confirm it opens
      (an untested backup is not a backup)
- [ ] Check LLM provider pricing against `RATES_PER_1K` in
      [usageTracking.js](../apps/api/src/engine/usageTracking.js); stale rates
      make every dashboard cost figure wrong
- [ ] Confirm no provider has retired a configured model — the `[llm]` startup
      lines say so explicitly
- [ ] Review API keys unused for 90+ days with the tenants that own them

---

## 3. Incident procedures

### 3.1 The API will not start

```bash
docker logs kgt-ai-hub-api 2>&1 | grep -A4 "\[startup\] FATAL"
```

In production the API deliberately refuses to boot on an unsafe config, and the
message lists each problem with its fix, numbered. Every check lives in
[assertProdSafety.js](../apps/api/src/utils/assertProdSafety.js):

| Message | Fix |
|---|---|
| `JWT_SECRET must be set to a real secret` | `openssl rand -hex 32` into `.env.docker` |
| `CORS_ORIGINS must list the web app origin(s)` | set it to the dashboard origin(s), comma-separated |
| database unreachable | `docker ps` on Postgres; check it is healthy and the credentials in `.env.docker` match the existing volume |
| `CRAWLER_ALLOW_PRIVATE_HOSTS … is for tests only` | a test env file leaked into this deployment — it disables the SSRF guard | remove the line |
| `SMTP_ALLOW_INSECURE … is for tests only` | likewise; it would send sign-in codes without TLS | remove the line |
| `OPENAI_BASE_URL must be an https:// URL` | a test stub endpoint left configured | remove it, or set an https endpoint |

Then recreate — **not** restart, which keeps the old environment:

```bash
docker compose --env-file .env.docker up -d api
```

### 3.2 Every bot answers "try again in a few minutes"

This is graceful degradation: every LLM provider failed. Tickets are still being
filed, so nothing is lost, but no customer is getting a real answer.

```bash
docker logs --tail 200 kgt-ai-hub-api 2>&1 | grep -E "\[(llm|chatEngine)\]"
```

| What you see | Cause | Fix |
|---|---|---|
| `no API key set for any provider` | keys missing | add `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, recreate the container |
| `model "…" is not available for this key` | the provider retired the model | set `GROQ_MODEL` / `OPENAI_MODEL` to one of the models the log suggests |
| `did not respond within 20000ms` | provider slow or down | confirm their status page; add or promote a fallback provider in `LLM_FALLBACK` |
| rate limit on every attempt | plan exhausted | raise the plan, or add a second provider |

**Mitigation to keep in place:** configure at least two providers. The chain
fails over per request, so one dead provider becomes invisible rather than an
outage.

### 3.3 The dashboard loads but cannot reach the server

Symptom: the page renders its skeleton, then *"Couldn't reach the server"*, and
the browser console shows requests to `http://localhost:4100` blocked by the
Content Security Policy.

Cause: the web image was rebuilt **without the env file**, so this build arg in
`docker-compose.yml`

```yaml
args:
  NEXT_PUBLIC_API_URL: ${PUBLIC_API_URL:-http://localhost:4100}
```

fell through to its default and compiled `localhost` into the JavaScript. Every
visitor's browser then tries to reach port 4100 on *their own machine*. The API
is unaffected — it reads `env_file:` at runtime — so it stays healthy while the
dashboard cannot talk to it, which makes this look like an API outage when it is
a front-end build problem.

Confirm it in one command, without logging in:

```bash
curl -s https://<host>/_next/static/chunks/<chunk>.js | grep -o 'http://localhost:[0-9]*'
```

Fix, and prevent it recurring:

```bash
cd /path/to/kgt_ai_work-
ln -s .env.docker .env          # compose then reads it even without the flag
docker compose --env-file .env.docker up -d --build web
docker compose config | grep NEXT_PUBLIC_API_URL   # must show the public URL
```

**`docker restart` and a flagless `up -d --build` are the two ways to lose this
value.** The symlink closes the second one; there is no reason not to have it on
every host.

### 3.4 Emails are not arriving

```bash
docker logs kgt-ai-hub-api 2>&1 | grep -E "\[(mailer|leads)\]"
```

| Line | Cause | Fix |
|---|---|---|
| `no mail transport configured` | `SMTP_*` unset | set them; in production this is logged as an ERROR |
| `535 5.7.3` on auth | SMTP AUTH disabled, wrong password, or MFA without an app password | §5.5 of DOCUMENTATION.md |
| `550 5.7.60 SendAsDenied` | `SMTP_FROM` is not the mailbox that logged in | make `SMTP_FROM` equal `SMTP_USER` |
| `[mailer:dev] NOT delivered` | not production and no SMTP — mail was printed, not sent | expected locally; set `SMTP_*` to really send |
| `[leads] … SKIPPED … cooldown` | same address already emailed within 24 h | expected anti-spam behaviour |

A mail failure never breaks a chat or a signup — it only means a visitor did not
get their confirmation, or a client did not get a reset code.

### 3.5 One tenant's bots stopped working

Work down this list:

1. **Is the account active?** `/admin` → the tenant. `active = false` disables
   the dashboard, every key and the widget at once.
2. **Is the key live?** A revoked or rotated key returns 401 on every message.
   Check the tenant's Keys page against what is actually in their page source.
3. **Is the slug right?** A wrong slug is a 404. The slug is the routing key.
4. **Are they rate limited?** 30 chats per 10 minutes per tenant by default
   (`TENANT_CHAT_RATE_LIMIT_MAX`, `TENANT_CHAT_RATE_LIMIT_WINDOW_MIN`). A busy
   site needs this raised — it is a cost guard, not a security control.
5. **Is it platform-wide?** Try the showcase tenant. If that fails too, go to
   §3.2.

### 3.6 A bot refuses to answer something it clearly knows

Almost always content scoping, not a bug:

1. The tenant's **Test bots → Knowledge split** shows how many sections each bot
   can use. A bot with very few is being starved by scoping.
2. Open the document in question: its **"Used by"** may be `SUPPORT` or `SALES`
   when the content is relevant to both. Set it to `BOTH`.
3. Check the **category**. A price or a return window living in a
   `CORE_OVERVIEW` marketing page competes with prose; as `CUSTOM_POLICY` it is
   weighted up for money and rules questions.
4. Re-run the **readiness audit** — a stale report means the documents changed
   since it ran.
5. If retrieval genuinely cannot match the phrasing, add an `FAQ` document that
   asks the question in the customer's own words.

Tickets are the data source here: `GET /tickets` is literally the list of
questions the bots could not answer.

### 3.7 Cost or usage spike

```bash
# per-tenant usage is on each dashboard's Usage page; for the raw view:
docker exec -it kgt-ai-hub-postgres psql -U kgthub -d kgthub -c \
  "SELECT \"tenantId\", count(*), sum(\"estimatedCostUsd\")::numeric(10,4)
     FROM \"UsageLog\" WHERE \"createdAt\" > now() - interval '24 hours'
     GROUP BY 1 ORDER BY 3 DESC LIMIT 10;"
```

| Pattern | Likely cause | Action |
|---|---|---|
| One tenant far above the rest | a busy site, or a scraped widget | confirm with them; lower `TENANT_CHAT_RATE_LIMIT_MAX` if abusive |
| Cache hit rate near zero | documents being edited constantly, which invalidates the cache | expected during onboarding; should settle |
| Cost per answer rising with no traffic change | a fallback provider is serving most traffic | check `[llm]` lines — the primary may be failing silently per request |
| Many audit calls | a client re-running the readiness check repeatedly | expected; it is rate-limited at 12 per 10 min |

### 3.8 Suspected data exposure between tenants

Treat as high severity. Isolation is structural — every per-tenant query is
scoped by `tenantId` from the session — and it is covered by the `db` test layer:

```bash
# includes db/tenantIsolation.test.js
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from api-tests
```

Capture the request, the token type used, and the exact endpoint before changing
anything. If the isolation tests pass, suspect a *client-side* mix-up (a stale
token, a browser session, or a tenant's own page embedding another tenant's key)
before suspecting the API.

---

## 4. Tenant lifecycle operations

### Create a tenant manually (staff)

`/admin` → new tenant. Use this for assisted onboarding; self-serve signup
creates the same rows. A staff-created tenant has no `signupEmail` and no client
login until one is created.

### Deactivate

`/admin` → the tenant → set inactive. Immediate, reversible, destroys nothing:
the dashboard, every API key and the widget all stop. This is the correct
response to non-payment or an abuse report.

### Rotate a tenant's key

Always in this order, so the site never goes dark:

```
1. Issue a new key (label it with the date)
2. The tenant updates their embed
3. Send one test message and confirm an answer
4. Revoke the old key
```

Revoking the last live key needs `?force=true`, precisely because it takes a
live widget offline.

### Raise a tenant's chat limit

`TENANT_CHAT_RATE_LIMIT_MAX` / `TENANT_CHAT_RATE_LIMIT_WINDOW_MIN` are
**platform-wide**, not per tenant. Raising them raises the ceiling for everyone,
so weigh it against total LLM spend. Recreate the API container afterwards.

### Delete a tenant (erasure request)

Everything cascades from the `Tenant` row — users, documents, keys, consents,
sessions, messages, tickets, leads, usage. Take a backup first; this is
irreversible.

---

## 5. Backup and restore

### Take a backup

```bash
docker exec kgt-ai-hub-postgres pg_dump -U kgthub -d kgthub -Fc \
  > kgthub_$(date +%F).dump
```

Dumps contain personal data — lead emails, chat transcripts, summaries. Store
them encrypted, keep them off the application host, and never commit them.

### Restore

```bash
docker exec -i kgt-ai-hub-postgres pg_restore -U kgthub -d kgthub --clean \
  < kgthub_YYYY-MM-DD.dump
```

Restore into an empty or scratch database first and verify, before ever pointing
it at production.

### Wipe test data

Removes every company and all of its data, and every staff account except
`HUB_ADMIN_EMAIL`:

```bash
docker exec kgt-ai-hub-api npm run db:reset              # dry run — shows what is there
docker exec kgt-ai-hub-api npm run db:reset -- --yes     # do it
```

Add `--with-showcase` to re-create the demo tenant. The API seeds on every
start, so set `SEED_FLATBRIZ_TENANT=false` if it should stay gone.

---

## 6. Deployment and upgrades

```bash
git pull
docker compose --env-file .env.docker up -d --build   # migrations apply on start
```

| Change | What is needed |
|---|---|
| Code | `up -d --build` |
| Environment only | `up -d api` — a recreate. `docker restart` keeps the old environment |
| `PUBLIC_API_URL` | `--build`, because it is compiled into the web bundle |
| Migrations by hand | `docker exec kgt-ai-hub-api npx prisma migrate deploy`; check with `migrate status` |

### Before a release

- [ ] Both release-gate suites green on the release commit (§6.7 of
      DOCUMENTATION.md)
- [ ] A fresh backup exists
- [ ] Migrations reviewed for safety against populated data
- [ ] Startup log checked after deploy: `[startup]`, `[llm]`, `[mailer]`

### Rollback

```bash
git checkout <previous-tag>
docker compose --env-file .env.docker up -d --build
```

Code rolls back cleanly. **Migrations do not** — a schema change that an older
build cannot read needs a database restore, which is why the backup comes first.

---

## 7. Scaling constraints — read before adding a second instance

Several things live in process memory
([DOCUMENTATION.md §7](../DOCUMENTATION.md)):

| In-memory | Effect of a second instance |
|---|---|
| Rate limiters | limits multiply by the instance count |
| Answer cache | lower hit rate; invalidation does not cross instances, so one instance can serve an answer from documents the other has already replaced |
| Pre-signup audit hand-off | a wizard hitting a different instance at `/complete` re-audits in the background |
| Pending lead-summary timers | lost on restart; the summary written at capture time survives |

Run **one API instance** until these move to a shared store (Redis or
equivalent). Vertical scaling and a connection-pool increase go a long way
first; the chat path is one database read plus one LLM call.

---

## 8. Escalation

Collect these before escalating — they answer most of the first questions:

1. `docker logs --tail 300 kgt-ai-hub-api` around the time of the incident
2. The tenant slug and, for chat problems, the `sessionId` from the response
3. The exact request: method, path, status, and *which* credential type was used
4. Whether the showcase tenant reproduces it (platform-wide vs one tenant)
5. `docker ps` and the restart counts
6. The last deployment's commit or tag

Never paste an API key, an OTP, a JWT or a `.env.docker` into a ticket. The slug
and the key *prefix* (`tk_3f9a1c`) are enough to identify a key.
