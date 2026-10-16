# Developer Guide

Getting productive in this codebase: how to run it, how it is organised, the
conventions it follows, and how to make the changes you are most likely to be
asked for.

Read [PROCESS_FLOW.md](PROCESS_FLOW.md) first if you do not yet know what the
product does end to end.

---

## 1. Local setup

### With Docker (closest to production)

```bash
cp .env.docker.example .env.docker
# minimum: one LLM key (GROQ_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY),
#          HUB_ADMIN_EMAIL, HUB_ADMIN_PASSWORD, JWT_SECRET
docker compose --env-file .env.docker up -d --build
```

| Service | URL |
|---|---|
| Signup wizard | http://localhost:3100/register |
| Client dashboard | http://localhost:3100/login |
| Staff console | http://localhost:3100/admin/login |
| API | http://localhost:4100 (`/health`) |
| Postgres | localhost:5440 |

On first start the API applies migrations and seeds: the operator account from
`HUB_ADMIN_*`, and the showcase tenant **FLATBRIZ** (`slug: flatbriz`) with six
documents from `apps/api/prisma/seed-data/flatbriz/`. Seed documents are written
only on first creation, so console edits survive a restart. Set
`SEED_FLATBRIZ_TENANT=false` for a clean platform.

Find the showcase API key: `docker logs kgt-ai-hub-api | grep "API key"`, or pin
it with `FLATBRIZ_TENANT_API_KEY` so it is stable across redeploys.

### Without Docker (faster iteration)

```bash
docker compose --env-file .env.docker up -d postgres    # just the database

cd apps/api
cp .env.example .env && npm install
npx prisma migrate deploy && node prisma/seed.js
npm run dev                                             # :4000

cd ../web
cp .env.local.example .env.local && npm install
npm run dev                                             # :3001
```

### Everyday commands

| Command | Where | Does |
|---|---|---|
| `npm run dev` | `apps/api` | start the API |
| `npm test` | `apps/api` | unit + integration (no database needed) |
| `npm run test:all` | `apps/api` | all four layers — needs Postgres |
| `npm run prisma:migrate` | `apps/api` | create a migration from a schema change |
| `npm run prisma:studio` | `apps/api` | browse the database |
| `npm run seed` | `apps/api` | re-run the seed (idempotent) |
| `npm run db:reset` | `apps/api` | dry-run wipe; `-- --yes` to actually do it |
| `npm run dev` | `apps/web` | start Next.js on :3001 |

---

## 2. Repository map

```
apps/
  api/                       Express + Prisma
    prisma/
      schema.prisma          the data model — read this early
      migrations/            one directory per migration, applied on boot
      seed.js, reset.js      seeding and the data-wipe tool
      seed-data/flatbriz/    showcase tenant documents
    public/widgets/          the embeddable chat widget (plain JS, no build)
    src/
      app.js                 Express wiring: one route prefix per trust boundary
      server.js              startup validation, then listen
      routes/                HTTP layer only — validate, delegate, respond
      middleware/            auth gatekeepers, error handler
      services/              business logic
        shared/              reusable: crawler, ingest, search, scoping
      engine/                the bot pipeline (domain-agnostic)
      domains/              the domain profiles the engine runs
      utils/                 small, dependency-free helpers
      lib/prisma.js          the single Prisma client
    test/                    unit | integration | db | system
  web/                       Next.js (pages router) + Tailwind
    pages/                   routes; dashboard/* for clients, admin/* for staff
    components/              signup/, workspace/, shell/, auth/, ui/, charts/
    lib/                     API client and shared enums mirrored from the API
e2e/                         Playwright: real browser, offline
docs/                        this guide, the process flow, the runbook
```

### The engine / domain split

This is the central design idea, and worth understanding before changing
anything in `engine/`:

- **`engine/` knows nothing about any business.** It has no notion of pricing
  objections, return policies, or a specific company. It takes a *profile* and
  runs a fixed pipeline: actions → retrieve → gate → generate → format.
- **`domains/` supplies the profiles.** `tenantProfile.js` builds a Support and a
  Sales profile for any tenant from that tenant's own database row — name,
  industry, persona, thresholds. There is no file per industry.
- Everything optional is **opt-in per profile**: confidence gating, ticketing,
  usage tracking, the answer cache, the contextual bridge reply. A profile that
  sets none of them gets the plain pipeline.

So: "same pipeline, different data". A new vertical is a new `Tenant` row, not
new code.

---

## 3. Conventions

### Comments explain *why*

The codebase is heavily commented, and the comments carry decisions and
rejected alternatives — see [confidence.js](../apps/api/src/engine/confidence.js)
for the clearest example: it records the formula that was tried first, the exact
case where it failed, and why the current curve replaced it.

Match that style. A comment that restates the code is noise; a comment that
stops the next person re-making a mistake is the most valuable thing in the
file. When you change a decision, update the comment that explains the old one.

### Routes are thin

A route handler validates input, calls a service, maps errors to status codes.
Business logic lives in `services/` or `engine/`. The clearest example is
[tenantChat.js](../apps/api/src/services/tenantChat.js): `runTenantChat` is the
real function and `handleChat` is a four-line Express adapter, which is why the
widget, the client sandbox and the staff console share one implementation.

### Validation is server-side and absolute

Never trust a client-supplied bound. `normalizePages` re-caps page count, title
length and content length at `/register/complete` **regardless** of what passed
through `/analyze` — because the two calls are independent and anyone can post
to the second one.

### Parse results, not exceptions, for user input

Validators return `{ ok: true, value }` or `{ ok: false, error }`
(`parseBotScope`, `parseBotPreference`, `parseBotType`). Unknown enum values are
**rejected**, never silently defaulted: a typo'd `botType` in a customer's embed
snippet must not quietly serve the wrong persona.

### Tenant scoping is structural

Every per-tenant query reads the tenant from the session only, and looks up each
row id *together with* that tenant's id:

```js
// right — another tenant's row reads as "not found"
prisma.tenantDocument.findFirst({ where: { id: documentId, tenantId: req.tenant.id } })

// wrong — a check you have to remember to add afterwards
prisma.tenantDocument.findUnique({ where: { id: documentId } })
```

Never read a tenant id from a request body, a query string or a JWT claim.

### Background work never breaks a request

Lead summaries, confirmation emails, FAQ generation and usage logging are
fire-and-forget, each wrapped so a failure is logged and swallowed. A chat reply
must not fail because an email bounced. Conversely, nothing a user is waiting on
is left to a background job.

### Secrets are hashed or shown once

API keys and OTP codes are stored only as hashes; plaintext is returned exactly
once at creation. Email addresses in logs go through `maskAddress`. Never log a
key, a code, or a token value.

### Dependencies stay few

Node's built-in `fetch` instead of an LLM SDK; `cheerio` instead of a scraping
framework; plain JS for the widget with no build step. Before adding a
dependency, check whether a dozen lines in `utils/` would do.

---

## 4. How to make common changes

### Add an API endpoint for the client workspace

1. Add the handler to
   [tenantWorkspace.routes.js](../apps/api/src/routes/tenantWorkspace.routes.js).
   It is mounted twice — under `/client/workspace` for clients and under
   `/tenants/:tenantId` for staff — so one handler serves both; read
   `req.tenant` and nothing else.
2. Put the logic in a service; keep the route thin.
3. Add an integration test under `test/integration/`.
4. Add it to Appendix A of [DOCUMENTATION.md](../DOCUMENTATION.md).

### Change the data model

```bash
cd apps/api
# edit prisma/schema.prisma
npm run prisma:migrate          # creates prisma/migrations/<timestamp>_<name>/
```

- Keep the comment on the model or field saying what it is for — the schema is
  documentation here, not just DDL.
- Enums mirrored in JS (`DocumentCategory` ↔ `documentCategory.js`, `BotScope` ↔
  `botScope.js`) must be changed in both places; the files say so.
- Invariants that matter belong in the database as CHECK constraints or unique
  indexes, not only in application code — see the `botType`, `botPreference` and
  lower-cased-email constraints in existing migrations.
- Migrations are applied automatically on container start, so they must be safe
  to run against a populated database.

### Tune bot behaviour

| Change | Where |
|---|---|
| Persona, tone, grounding rules | [tenantProfile.js](../apps/api/src/domains/tenantProfile.js) prompts |
| Shared style rules (bullets, length) | [promptBuilder.js](../apps/api/src/engine/promptBuilder.js) |
| Category weights, relative cut-off | `*_CATEGORY_WEIGHTS`, `RELATIVE_MIN_SCORE` in `tenantProfile.js` |
| Confidence curve | [confidence.js](../apps/api/src/engine/confidence.js) — read the comment first |
| Per-tenant threshold | `Tenant.minConfidence` (data, not code) |
| Scoping keywords | [botScope.js](../apps/api/src/services/shared/botScope.js) |

Keep scoping and category vocabulary **sector-neutral**. This platform is resold
to any industry; a keyword list that assumes software, or retail, or property
breaks every tenant that is not one of those.

### Add a conversational intent

Register it in [handoffActions.js](../apps/api/src/domains/handoffActions.js).
Actions run **before** retrieval, so a false positive hides a real answer —
match narrowly (short messages, specific phrasings) and put the wording in the
profile's `handoffCopy` so each bot keeps its own voice. Add cases to
`test/integration/handoffActions.test.js`, including the near-misses that must
*not* match.

### Add an LLM provider

Extend [llmClient.js](../apps/api/src/engine/llmClient.js): a request builder, a
response parser, a token-usage reader, and an entry in the provider chain. Add
its model prices to `RATES_PER_1K` in
[usageTracking.js](../apps/api/src/engine/usageTracking.js) or cost estimates
silently report `$0`. Make sure a failure raises `ChatConfigError`,
`ChatRateLimitError` or `ChatUpstreamError` — those three are what the engine
catches to degrade gracefully.

### Add a dashboard page

Add `apps/web/pages/dashboard/<name>.js` wrapped in `DashboardShell`, put the
substance in a `components/workspace/<Name>Panel.js`, and call the API through
`lib/api.js`. Mirror any API enum into `lib/` rather than hardcoding strings in
components.

---

## 5. Testing

Full detail is in [TESTING.md](../TESTING.md). The shape of it:

| Layer | Needs | Covers |
|---|---|---|
| `test/unit/` | nothing | pure logic: scoring, confidence, parsing, rate limits, ingest |
| `test/integration/` | nothing (in-memory DB) | routes and services wired together |
| `test/db/` | real Postgres | constraints and tenant isolation at the database level |
| `test/system/` | real Postgres | HTTP surface, migrations, rate limits, offline behaviour |
| `e2e/` | Docker | real browser journeys, offline |

The release gate is both commands below. Tests run with **no route to the
internet**, which is deliberate: it proves no code path depends on reaching an
LLM or a website.

```bash
# all backend layers: unit, integration, db, system
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from api-tests

# browser journeys
docker compose -f docker-compose.e2e.yml  up --build --abort-on-container-exit --exit-code-from e2e
```

Where a new test goes: pure function → `unit`; two modules or a route →
`integration`; a constraint or an isolation guarantee → `db`; a startup guard,
a limit, or something about the process itself → `system`; a user journey →
`e2e`.

---

## 6. Debugging

### Start with the startup log

```
[llm] groq: model "…" is available
[mailer] sending via smtp (SMTP login OK) as …
KGT AI Hub API running at http://localhost:4000
```

Most "it does not work" reports are visible here: a missing LLM key, a retired
model, a failed SMTP login, or a fatal config refusal.

### Log lines worth knowing

| Prefix | Means |
|---|---|
| `[startup] FATAL` | a production safety check refused to boot; the message lists what to fix |
| `[llm] WARNING` | a provider is unconfigured or its model is unavailable — chats will skip it |
| `[chatEngine] …: LLM unavailable, served degraded answer` | every provider failed, with each attempt named |
| `[register] signup refused (…)` | a signup rejection, with a masked address and the reason |
| `[leads] … SKIPPED … cooldown` | the confirmation email was within the per-address cooldown |
| `[mailer:dev] NOT delivered` | no SMTP configured outside production — the mail was printed, not sent |

### Checks for the usual suspects

| Symptom | Check |
|---|---|
| Every answer is a fallback | the `[llm]` startup lines; then whether a key is set |
| A bot will not answer something it should know | the document's category and "Used by"; Test bots → Knowledge split |
| An edit to a document seems ignored | that the change path calls `invalidateTenantKnowledge` |
| Config change had no effect | `docker restart` keeps the old environment — use `docker compose --env-file .env.docker up -d api` |
| Rate limits trigger far too early | `TRUST_PROXY_HOPS` must match the real number of proxies, or every visitor shares one bucket |

---

## 7. Production checklist

Before pointing real traffic at a deployment:

- [ ] `DEPLOY_ENV=production` — the API then refuses to boot with a placeholder
      `JWT_SECRET`
- [ ] `JWT_SECRET` random, 16+ characters
- [ ] `CORS_ORIGINS` set to the dashboard origins only
- [ ] `PUBLIC_API_URL` set, and baked into the web build
- [ ] `TRUST_PROXY_HOPS` matches the proxy count in front of the API
- [ ] At least one LLM key, and the startup log confirms the model exists
- [ ] `SMTP_*` configured and the startup log says `SMTP login OK`
- [ ] `HUB_ADMIN_PASSWORD` changed from any example value
- [ ] `LEAD_CONFIRMATION_COOLDOWN_HOURS` not left at `0`
- [ ] Postgres backups scheduled and a restore tested
- [ ] Both release-gate test commands green on the release commit

Details for each in §5 and §6 of [DOCUMENTATION.md](../DOCUMENTATION.md) and in
[OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md).
