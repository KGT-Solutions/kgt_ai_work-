# Testing — KGT AI Hub

Four layers, from fastest and most isolated to slowest and most complete.
Each answers a different question; together they gate a release.

| Layer | Question it answers | Where | Needs | Run |
|---|---|---|---|---|
| **Unit** | Does this function / module do the right thing on its own? | `apps/api/test/unit/` | nothing | `npm run test:unit` |
| **Integration** | Do routes, middleware, auth and services work together? | `apps/api/test/integration/` (in-memory Prisma) and `apps/api/test/db/` (real PostgreSQL) | `db/`: a test database | `npm run test:integration` · `npm run test:db` |
| **System** | Does the whole deployed API meet its functional and non-functional requirements? | `apps/api/test/system/` | a test database | `npm run test:system` |
| **End-to-end** | Can a real person complete each business journey in a browser? | `e2e/` (Playwright) | Docker | `docker compose -f docker-compose.e2e.yml up …` |

`npm test` (in `apps/api`) runs unit + integration — no database, no network, about 20 seconds. It's the pre-commit check.

## The release gate

```bash
# 1. Every backend layer, offline, against a throwaway PostgreSQL (~2 min)
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from api-tests
docker compose -f docker-compose.test.yml down -v

# 2. Every user journey in a real browser, offline (~5 min; first build longer)
docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e
docker compose -f docker-compose.e2e.yml down -v
```

Both exit non-zero on any failure. Use `docker-compose` (with a hyphen) if your Docker has the standalone binary instead of the plugin.

**Zero external calls, by construction.** Both stacks run on a Docker network marked `internal`: there is no route to the internet, so a test that accidentally calls Groq, OpenAI, Anthropic, Resend or a real website fails instead of leaking data or spending money. `test/system/networkSandbox.test.js` proves the network is sealed on every run — if it ever passes an external request, the run fails. Neither stack reads `.env.docker` or any other secrets file.

## Framework

All backend layers use Node's built-in runner (`node:test` + `node:assert`) — no test dependencies, the same runner the suite has always used, and identical on Node 18 (WSL) and Node 20 (Docker). E2E uses **Playwright** (`@playwright/test`, pinned to the version of the `mcr.microsoft.com/playwright` image in `e2e/Dockerfile`; upgrade both together).

`apps/api/scripts/run-tests.js <layers…>` runs only `*.test.js` files from the named layer folders. (A bare `node --test test/` would also execute the helpers in `test/support/`.)

## Layer 1 — Unit (`apps/api/test/unit/`)

One module at a time; every collaborator stubbed, **every LLM call mocked**, provider keys blanked inside the test. Key suites:

| Suite | Covers |
|---|---|
| `botAuditor.test.js` | per-bot pillar weights, content caps (<800 → 25, <2500 → 60, <6000 → 85), level thresholds, JSON parsing of the model's report, heuristic fallback |
| `testSwitches.test.js` | the three test-only settings (below) are off by default and refused in production |
| `assertProdSafety.test.js` | production startup refuses weak `JWT_SECRET`, missing `CORS_ORIGINS`, test switches |
| `authTokens.test.js` | typed JWTs: a client token never works as an operator token and vice versa |
| `mailer.test.js` | SMTP config, error classification, masked addresses, no printed codes in production |
| `fileIngest.test.js` · `pdfIngest.test.js` | PDF / Word / TXT / MD / ZIP parsing; ZIP bomb limits; skipped hidden and nested files |
| `lexicalSearch.test.js` · `confidence.test.js` · `promptBuilder.test.js` | retrieval, stemming, typo tolerance, the answer confidence gate |
| `ipRateLimit.test.js` · `corsPolicy.test.js` · `errorHandler.test.js` | the building blocks of the system-level guarantees |

Pattern (mock before require; no network):

```js
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.GROQ_API_KEY = process.env.OPENAI_API_KEY = process.env.ANTHROPIC_API_KEY = '';
const llm = require('../../src/engine/llmClient');
mock.method(llm, 'generateAnswer', async () => ({ text: '{"pillars": …}', provider: 'test', usage: {} }));
const { auditKnowledge } = require('../../src/services/botAuditor');

test('a support-only company is scored on support content', async () => {
  const report = await auditKnowledge({ company, documents, botPreference: 'support' });
  assert.deepEqual(Object.keys(report.bots), ['support']);
});
```

## Layer 2 — Integration

### `apps/api/test/integration/` — top-down, in-memory database

Real Express routes, real middleware and auth, real services; Prisma replaced by an in-memory stub so every edge case is fast and deterministic: email verification and OTP lifecycle (`emailVerification.test.js`), password reset (`passwordReset.test.js`), client sign-in (`clientSignIn.test.js`), leads capture → summary → confirmation email with SMTP mocked (`leads.test.js`, `leadsRoute.test.js`), readiness routes (`readinessRoutes.test.js`), the chat engine (`chatEngine.test.js`).

### `apps/api/test/db/` — bottom-up, real PostgreSQL

The same app on real Prisma and real SQL, for what an in-memory stub can't prove:

- **`tenantIsolation.test.js`** — two companies, each signed in with its own session and API key. Company A cannot list, read, edit or delete company B's documents, leads or tickets (another company's ids answer 404 and nothing changes); a widget API key never works for another company; another company's chat session id starts a fresh session instead of joining theirs; each company's bots load only their own knowledge; staff see both; deleting a company cascades to everything it owns and nothing else.
- **`constraints.test.js`** — rules the database enforces itself: one account per email (in any letter case), one self-serve company per signup email, CHECK constraints on bot types, ticket kinds, summary states, readiness scores and bot preference, unique API key hashes and verification rows.

## Layer 3 — System (`apps/api/test/system/`)

The complete application as deployed:

| Suite | Requirement |
|---|---|
| `http.test.js` | `/health`; unknown API paths are JSON 404s; malformed JSON → 400; >10MB → 413; every protected prefix refuses no / forged tokens; CORS open for the widget only; widget script served |
| `rateLimits.test.js` | with shipped defaults: signup code 5 / 15 min / IP (another visitor unaffected), pre-flight audit 12 / 10 min / IP, client sign-in 10 / 15 min / IP, widget chat 30 / 10 min per company whatever the IP |
| `databaseResilience.test.js` | the real server process with its database unreachable: stays up, `/health` answers, DB-backed requests fail as a generic JSON 500 that leaks no connection string, no crash under repeated failures |
| `migrations.test.js` | migration folders are timestamped and ordered; every migration is applied; the migrated database matches `schema.prisma` exactly (`prisma migrate diff --exit-code`) — a schema change without a migration fails here |
| `networkSandbox.test.js` | inside the sandbox only: no route to any LLM provider, Resend or the internet |

### Running the `db` and `system` layers locally

```bash
docker run -d --name kgt-test-pg -e POSTGRES_USER=kgt -e POSTGRES_PASSWORD=kgt -e POSTGRES_DB=kgt_test -p 5441:5432 postgres:16-alpine
cd apps/api
TEST_DATABASE_URL="postgresql://kgt:kgt@localhost:5441/kgt_test?schema=public" npm run test:all
```

Safety rails (`test/support/realStack.js`): without `TEST_DATABASE_URL` these suites skip; the database name **must contain "test"** or they refuse to run; every LLM, SMTP and Resend setting is blanked before the app loads, whatever `apps/api/.env` says; tests create uniquely named rows and delete only their own tenants. `test/support/prepareTestDb.js` applies the migrations first.

## Layer 4 — End-to-end (`e2e/`)

A real Chromium (Playwright) drives the real web app, which calls the real API and database — all in `docker-compose.e2e.yml`, offline. The outside world is replaced by local stand-ins:

- **Mailpit** receives every email over real SMTP. Tests read OTP codes and confirmations from its API (`e2e/support/mailpit.js`).
- **`e2e/stubs/server.js`** is a fake OpenAI-compatible LLM plus a small fixture company website ("Northwind Thermostats") for the crawler. The fake LLM answers deterministically: the readiness audit scores the Support Bot low until the knowledge contains a refund policy; a lead summary is a fixed text; chat gets a short bullet answer.

| Spec | Journey |
|---|---|
| `registration.spec.js` | account → email code from Mailpit → company → choose **Both** → upload Markdown + a ZIP → website scan (button disabled until the legal checkbox is ticked) → the training check runs automatically → Support below 80 % with "Upload your company Return & Refund Policy" in the path to 100 % → inline upload → the requirement disappears and the Support % rises → review → launch → dashboard |
| `passwordReset.spec.js` | unknown email → "No account found…"; real email → code from Mailpit → new password → "Sign in now" → old password refused → new password signs in |
| `dashboard.spec.js` | sign in → switch deployed bots to Support only (persists across reload) and back → knowledge split view → one question to both bots side by side → "Can I book a demo?" to Sales → email in chat → prospect receives the confirmation email → lead appears with its AI summary → mark contacted. Plus: staff sign in to the staff console and see the company |

Test data is created through the real public API (`e2e/support/api.js` signs a company up with a real emailed code), so every spec stands alone. Failures keep a trace, screenshot and video in `e2e/test-results/`; the HTML report is in `e2e/playwright-report/` (`cd e2e && npx playwright show-report`).

**Against a stack you're already running** (e.g. `next dev` + `npm run dev` + Mailpit): `cd e2e && npm ci && npx playwright install chromium`, then set `E2E_BASE_URL`, `E2E_API_URL`, `MAILPIT_URL`, `E2E_SITE_URL` and run `npx playwright test`.

### Test-only settings

The E2E stack needs three API settings that are **off by default and refused at startup when `DEPLOY_ENV=production`** (`utils/assertProdSafety.js`, unit-tested in `testSwitches.test.js`):

| Setting | Effect | Why production refuses it |
|---|---|---|
| `OPENAI_BASE_URL` | sends OpenAI calls to another OpenAI-compatible server (the fake LLM) | non-https values would send prompts in clear text (https values are allowed — e.g. a gateway) |
| `SMTP_ALLOW_INSECURE=true` | plaintext SMTP to a local catcher | sign-in codes would travel unencrypted |
| `CRAWLER_ALLOW_PRIVATE_HOSTS=true` | lets the crawler reach private addresses (the fixture site) | it would turn the crawler into an SSRF tool |

## Writing new tests — where does it go?

- A pure function or one service with its collaborators stubbed → **unit**.
- A route through its middleware and services, edge cases via the in-memory stub → **integration**.
- Anything that depends on real SQL — constraints, cascades, transactions, cross-tenant queries → **db**.
- A property of the running server — limits, error shapes, startup, migrations → **system**.
- A journey a customer or staff member takes through the UI → **e2e**. Keep these few and valuable; push detail down a layer.

Rules that keep the suite trustworthy: never call a real provider (blank the keys, mock `llm.generateAnswer` before requiring the module under test); give each test its own data (unique emails, slugs and IPs) so files can run in parallel; never retry a flaky test — fix it.
