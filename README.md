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
         - /api/v1/public/register   self-serve signup: crawl a website or parse PDFs, then train
         - /api/v1/tenant-chat/:slug Support + Sales chat (per-tenant API key)
         - /api/v1/tenants           tenant, document, API-key management (operators)
         - /api/v1/operator          operator console sign-in
         - /widgets/tenant-chat-widget.js  embeddable chat widget
  web/   Next.js
         - /register                 public onboarding wizard for companies
         - /login, /tenants          operator console: tenants, documents, API keys,
                                     live bot testing, tickets, usage
```

## Run it (Docker)

```bash
cp .env.docker.example .env.docker
# edit .env.docker: at least one LLM key (GROQ_API_KEY / OPENAI_API_KEY /
# ANTHROPIC_API_KEY), HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD, and JWT_SECRET
docker compose --env-file .env.docker up -d --build
```

| Service | URL |
|---|---|
| Onboarding wizard | http://localhost:3100/register |
| Operator console | http://localhost:3100/login |
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

Everything uses its own container names (`kgt-ai-hub-*`), volume and ports, so
it runs alongside other stacks on the same host.

## Try the bots

In the console, open a tenant → **API keys** → issue a key → **Test bots**.
Or call the API directly:

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
