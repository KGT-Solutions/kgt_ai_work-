# KGT AI Hub — Support & Sales Bots for Any Company

A multi-tenant SaaS platform: each customer company (a **tenant**) signs up,
trains two chatbots on its own content, and embeds them on its website.

- **Support Bot** answers strictly from the tenant's documents. A 30% confidence
  gate hands anything it can't ground to a human (a support ticket) instead of
  guessing.
- **Sales Bot** is persuasive but grounded: it highlights tagged benefits,
  handles pricing, competitor and returns objections, and never invents facts.

Both bots share one knowledge base per tenant, split into three categories —
**Company overview**, **FAQs**, and **Policies / pricing / manuals** — which
each bot weights differently.

## Repository layout

```
apps/
  api/   Express + Prisma API (Postgres)
         - /api/v1/public/register    self-serve signup (website scan + file parsing, then launch)
         - /api/v1/client             client sign-in / me
         - /api/v1/client/workspace   the signed-in company's own documents, keys, test chat, tickets, usage
         - /api/v1/tenants            every company — KGT staff only
         - /api/v1/operator           staff sign-in
         - /api/v1/tenant-chat/:slug  Support + Sales chat for the widget (per-tenant API key)
         - /widgets/tenant-chat-widget.js  embeddable chat widget
  web/   Next.js
         - /register                  signup wizard → lands the company on its dashboard
         - /login, /dashboard         client companies: their own bots only
         - /admin/login, /admin       KGT staff: master control over every company
```

## Who can see what

| | Signs in at | Token | Reaches |
|---|---|---|---|
| Client company | `/login` | `client` JWT | only its own tenant, resolved server-side from its account |
| Website widget | — | `tk_…` API key (stored as SHA-256) | only the tenant that owns the key |
| KGT staff | `/admin/login` | `operator` JWT | every tenant |

Tokens are typed, so a client token is refused on staff routes and the reverse
(`apps/api/src/utils/authTokens.js`). The per-tenant routes
(`routes/tenantWorkspace.routes.js`) read the tenant only from the session and
look up every document or key id together with that tenant's id, so another
company's data reads exactly like data that doesn't exist. Deactivating a
company in `/admin` immediately stops its dashboard, API keys and widget.

## Run it (Docker)

```bash
cp .env.docker.example .env.docker
# edit .env.docker: at least one LLM key (GROQ_API_KEY / OPENAI_API_KEY /
# ANTHROPIC_API_KEY), HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD, and JWT_SECRET
docker compose --env-file .env.docker up -d --build
```

| Service | URL |
|---|---|
| Signup wizard | http://localhost:3100/register |
| Client dashboard | http://localhost:3100/login |
| KGT staff console | http://localhost:3100/admin/login |
| API | http://localhost:4100 (health: `/health`) |
| Postgres | localhost:5440 |

On first start the API applies migrations and runs the seed:

- creates the operator account from `HUB_ADMIN_EMAIL` / `HUB_ADMIN_PASSWORD`;
- creates the showcase **Tenant #1, FLATBRIZ** (`slug: flatbriz`) with six
  documents from `apps/api/prisma/seed-data/flatbriz/`: resident and admin
  guides (FAQs), value propositions, client playbooks and competitor
  comparison (Core Overview), and billing rules (Policies). Documents are
  written only on first creation; edits made in the console are kept.
- gives Flatbriz its API key: the one in `FLATBRIZ_TENANT_API_KEY` if set
  (stable across redeploys), otherwise a random key printed once:
  `docker logs kgt-ai-hub-api | grep "API key"`.

Set `SEED_FLATBRIZ_TENANT=false` for a platform with no pre-installed tenant.

## Wipe test data

Removes every company and everything that belongs to one (client accounts,
documents, keys, consents, chats, tickets, usage) and every staff account
except `HUB_ADMIN_EMAIL`, which is kept or created. Irreversible, so back up first:

```bash
docker exec kgt-ai-hub-postgres pg_dump -U kgthub kgthub > kgthub-backup.sql
docker exec kgt-ai-hub-api npm run db:reset                 # dry run: shows what's there
docker exec kgt-ai-hub-api npm run db:reset -- --yes        # wipe
```

Add `--with-showcase` to re-create Tenant #1 afterwards. The API seeds on every
start, so set `SEED_FLATBRIZ_TENANT=false` if Flatbriz should stay gone.

Everything uses its own container names (`kgt-ai-hub-*`), volume and ports, so
it runs alongside other stacks on the same host.

## Try the bots

On the client dashboard (or, for staff, any company in `/admin`), open
**Test bots** — it chats through the signed-in session, no key needed. Or call
the widget endpoint directly:

```bash
curl -s -X POST http://localhost:4100/api/v1/tenant-chat/flatbriz/chat \
  -H "x-tenant-api-key: tk_..." -H 'Content-Type: application/json' \
  -d '{"query":"How do I pay my maintenance bill?","botType":"support"}'
```

`botType` is `support` (default) or `sales`. Pass the returned `sessionId` back
to continue a conversation.

To embed on a customer site:

```html
<script src="https://YOUR-API-HOST/widgets/tenant-chat-widget.js"
        data-tenant-id="flatbriz" data-api-key="tk_..." defer></script>
```

## Security model

- **API keys** are stored only as SHA-256 hashes; the plaintext is shown once.
  Rotate by issuing a new key, updating the embed, then revoking the old one.
- **Crawling consent**: the public wizard can't crawl without the visitor's
  authorization, and it's stored as a `TenantConsent` record.
- **SSRF**: every crawl target and redirect hop must resolve to a public
  address. The headless-browser tier (Chromium) routes all traffic through a
  loopback egress proxy with the same check, and runs only on the operator
  route, never the public one.
- **Rate limits**: public signup endpoints per IP, chat per tenant, operator
  sign-in per IP.
- Set `DEPLOY_ENV=production` in production: the API then refuses to start
  with the placeholder `JWT_SECRET`.

## Develop without Docker

```bash
docker compose --env-file .env.docker up -d postgres
cd apps/api && cp .env.example .env && npm install && npx prisma migrate deploy && node prisma/seed.js && npm run dev
cd apps/web && cp .env.local.example .env.local && npm install && npm run dev   # http://localhost:3001
npm test   # in apps/api
```
