# 🔭 KGT Orb V2 — Code-Grounded Feature Audit

> Audited against **KGT Orb: Final Features to Build (Version 2, 26 October 2026)**.
> Every status below was verified by reading the actual Prisma schema, API routes, services,
> chat engine, widget embed script, and frontend pages on branch `aakarsh/improvement`
> (HEAD `1203770`, including `2b36fc0`, `48c94b2`, `0fbb2fc`, `7527d77`). No status is inferred
> from prior docs. Where something is "Not started", it was confirmed absent from the schema,
> the route table, the service directory, and a content grep — not merely unseen.
>
> **Naming note:** the codebase ships as **"KGT AI Hub"**; the spec calls it **"KGT Orb"**. No
> `"Powered by KGT Orb"` string exists in the product at all (see Feature 13).

---

## 1. Executive Readiness Dashboard

### Step 0 — November 2026 Fix Sprint

| # | Item | Status | Evidence / gap |
|---|------|--------|----------------|
| 0.1 | Email alert on every lead | ✅ Implemented | `services/teamAlerts.js` (`notifyLeadCaptured`), `services/leads.js` dispatch, `GET/PATCH /notifications`, configurable `Tenant.teamEmail` |
| 0.2 | CSV export (leads/chats) | ❌ Not started | Only a **catalog template** CSV download exists (`CatalogPanel.js`, `/catalog/template`). No leads/chats export route or UI |
| 0.3 | AI notice + consent record | ❌ Not started | No "chatting with an AI" string in `tenant-chat-widget.js`; `TenantConsent` only models `WEBSITE_CRAWL`, not a chat-time AI disclosure/consent |
| 0.4 | Allowed domains + per-visitor rate limit | 🟡 Partial | Per-**tenant** limit `isTenantRateLimited` (300/10min, `tenantChat.js`) exists; **no** per-device (`browserId`+IP) limit and **no** origin/domain allowlist (widget CORS is intentionally open) |
| 0.5 | Price rule (quote if not in content) | ✅ Implemented | `domains/tenantProfile.js` grounding (money/price regex, "use only the prices the excerpts state"), `engine/promptBuilder.js` ("Never invent … prices"), off-scope → handoff/quote |
| 0.6 | Replace retiring AI models | ✅ Implemented | `engine/llmClient.js` `DEFAULT_MODELS` (groq `openai/gpt-oss-120b`, `gpt-4o-mini`, `claude-haiku-4-5`), env overrides, retirement-aware `verify` endpoint |
| 0.7 | New email service | ✅ Implemented | `services/mailer.js` supports SMTP (M365) **and Resend** (`RESEND_API_KEY`) + per-tenant SMTP + dev simulation, with failover |

### Global Locked Rules & Guardrails

| Rule | Status | Evidence / gap |
|------|--------|----------------|
| AI notice cannot be turned off | ❌ Not realized | The notice itself doesn't exist yet (blocked on 0.3). Nothing to "not turn off" |
| Strict grounding + price rule | ✅ Implemented | `tenantProfile.js`, `promptBuilder.js`, `engine/confidence.js` gate, pre-LLM handoff in `engine/ticketing.js` |
| Human-in-the-loop (no auto-send to buyer) | ✅ Respected | No AI-drafted reply is auto-sent to buyers; `leads.js` only sends a **receipt/acknowledgment** ("we've received your request" + recap of answers already shown in-chat), rate-limited by a cooldown. Feature 7 (drafting) isn't built, so there is no auto-send path. *Minor:* the receipt has no owner on/off toggle yet |
| Secrets encrypted/hashed | ✅ Implemented | `utils/encryption.js` AES-256-GCM (`TenantSmtpConfig.smtpPass`), SHA-256 key hash (`utils/tenantApiKeys.js`), HMAC OTP (`verificationService.js`), hashed passwords (`utils/password.js`) |
| Existing RBAC respected | ✅ Implemented | `middleware/operatorAuth.js` (staff) vs `middleware/clientAuth.js` (client), typed JWTs, `req.actor`, staff-only `tenantAdmin.routes.js` |
| Zero `"DPDP compliant"` / `"GDPR compliant"` | ✅ Clean | Repo-wide grep: only match is a `.gdpr` **CSS selector** in `crawler.js` (strips cookie banners). No compliance-claim copy anywhere |

### Features 1–18

| # | Feature | Status | One-line reason |
|---|---------|--------|-----------------|
| 1 | Excel & CSV upload | 🟡 Partial | CSV **product-catalog** importer only; no `.xlsx`, sheet picker, header/column controls, price opt-in, formula eval, or re-upload diff |
| 2 | Whole catalogue + keep fresh | 🟡 Partial | Crawler raised to 150 pages + browser fallback; no sitemap, plan tiers, path filters, weekly re-sync, or change report |
| 3 | Image upload in chat | 🟡 Partial | Widget attach UI + robust `imageGuardrailPipeline.js` **exist but are not wired into the chat turn**; no persistence, owner toggle, or multimodal read |
| 4 | Voice chat | ❌ Not started | No mic/STT/TTS in widget; no voice channel/fields |
| 5 | Escalation to a person | 🟡 Partial | Ticketing + confidence gate + email/alert built; missing trigger keywords, phone capture, cross-assistant single ticket, business-hours ETA, Zoho Desk/Freshdesk |
| 6 | WhatsApp handoff & channels | ❌ Not started | No `wa.me`, templates, or Cloud API/BSP |
| 7 | Drafted first reply for rep | ❌ Not started | Buyer receipt exists; no rep-facing draft/placeholders/send controls/"Replied" status |
| 8 | Google Sheets & webhooks | ❌ Not started | No OAuth, webhook model, HMAC, retry queue, or delivery log |
| 9 | CRM sync (Zoho/HubSpot) | ❌ Not started | No CRM integration code or models |
| 10 | Connect your email | 🟡 Partial | Custom SMTP (incl. Zoho Mail) + test + encryption + fallback; no Google/Microsoft OAuth, scopes, sender identity, or per-email-type toggles |
| 11 | Instructions editor | 🟡 Partial | Single `persona`/`outOfScopeMessage`/`minConfidence` editable **by staff only**; locked rules already injected **after** owner text in `promptBuilder.js`. No client editor, per-assistant split, presets, or version history |
| 12 | Test & compare AI models | 🟡 Partial | `BotSandbox` test chat + `llmClient` model-verify + provider failover chain; no side-by-side playground, latency/source compare, eval suites, or per-assistant "Use this model" |
| 13 | Appearance | 🟡 Partial | Welcome message + starter questions + language picker; colours/icon/logo/position **hardcoded**; no live preview; no "Powered by KGT Orb" (so nothing to remove); no AI notice |
| 14 | Auto-open after delay | ❌ Not started | No open-delay logic in widget |
| 15 | Visitor feedback (thumbs) | ❌ Not started | No feedback fields, UI, or route |
| 16 | Chat logs | 🟡 Partial | `SessionsPanel` + transcript + `ImprovementsPanel` (weak-answer queue) + tickets/leads; missing channel/feedback/paused/spam facets, search, per-turn model/latency/sources, images, row actions, CSV export, retention TTL, RTBF |
| 17 | Guardrails | 🟡 Partial | Per-tenant rate limit + token budget + prompt-injection scans + (unwired) image guardrail; no unified screen, per-device limit, spam auto-pause, or country blocking |
| 18 | Orb Copilot | ❌ Not started | No scaffolding found. **Deferred until Features 1–17 are live** (per spec) |

**How recent onboarding/runtime work helps:** sandbox isolation (`7527d77`/`2b36fc0`) gives Feature 12/16 clean, test-vs-live separation; the ticket→FAQ loop + auto re-audit (`2b36fc0`) is the backbone of Feature 5 escalation and Feature 16's "to review" workflow; widget install telemetry (`0fbb2fc`) adds the first `/ping` channel and a per-key telemetry column that Feature 16's "channel" tracking can extend; starter questions (`TenantFaq`) already deliver Feature 13's "up to 4 starter questions"; `teamAlerts`/`leads` satisfy Step 0.1; the confidence gate + `ticketing.js` satisfy the hard half of Feature 5.

---

## 2. Step 0 & Locked Rules — Line-by-Line Verification

**0.1 Email alert on every lead — ✅**
`services/leads.js` → `trackLeadActivity` → `teamAlerts.notifyLeadCaptured` (throttled, reply-to = visitor). Recipients from `Tenant.teamEmail` → signup email → dashboard users. UI: `components/workspace/LeadsAndSummaries.js`, `GET/PATCH /notifications` in `tenantWorkspace.routes.js`.

**0.2 CSV export (leads/chats) — ❌**
Grep for `text/csv|Content-Disposition|toCsv|new Blob` across `apps/web` and `apps/api/src/routes`: the only hits are the **catalog template** (`routes/tenantWorkspace.routes.js:449`, `components/workspace/CatalogPanel.js:16`). No endpoint serves leads or chat logs as CSV.

**0.3 AI notice + consent record — ❌**
Grep `chatting with an AI|AI assistant|automated` in `public/widgets/tenant-chat-widget.js`: **no visitor-facing disclosure**. `schema.prisma` `ConsentKind` = `WEBSITE_CRAWL` only; `TenantConsent` records crawl authorization, not a chat-time AI notice/consent.

**0.4 Allowed domains + per-visitor rate limit — 🟡**
`services/tenantChat.js:42` `isTenantRateLimited` keys by `tenant.id` (per-tenant, not per-device). No `browserId`/IP device bucket. `routes/tenantChat.routes.js` performs **no** `Origin`/`Referer` allowlist check (only reads `Referer` for `/ping` telemetry). CORS for the widget prefix is deliberately open (`utils/corsPolicy.js`).

**0.5 Price rule — ✅**
`domains/tenantProfile.js` (money/price intent regex `:181`, "use only the prices … the excerpts actually state" `:475`, "Never invent facts, prices …" `:449`); out-of-scope money questions route to the handoff/quote line (`Tenant.outOfScopeMessage`). `engine/promptBuilder.js:52` reinforces exact-value preservation.

**0.6 Replace retiring models — ✅**
`engine/llmClient.js:80` `DEFAULT_MODELS` are current; `:77` comments document the Groq `llama3-70b` retirement migration; `:358`+ a live model-verify endpoint flags `missing`/`unverified` models per key.

**0.7 New email service — ✅**
`services/mailer.js`: nodemailer SMTP (M365) **and** Resend (`isResendConfigured`, `RESEND_API_KEY`), per-tenant SMTP pool (`tenantSmtp.js`), and a simulation mode; `pickTransport` selects with fallback.

**Locked rules:** grounding/price (✅ above); human-in-the-loop (✅ — only a receipt is auto-sent, `leads.js:169 sendConfirmation`, no drafted answer auto-send exists); secrets (✅ `utils/encryption.js`, `tenantApiKeys.js`, `verificationService.js`); RBAC (✅ `middleware/*Auth.js`); no DPDP/GDPR copy (✅ grep-clean).

---

## 3. Feature-by-Feature Gap Analysis (1–17)

### Feature 1 — Excel & CSV upload — 🟡 Partial
- **Done-when:** `.xlsx`/`.csv` (10 MB), sheet picker, preview, header-row confirm, main-column select, hidden cost/margin columns, price-column opt-in (default No), row-level rows with headers, exact-value lookup (SKU/part/grade), formula-result eval, re-upload diff by filename.
- **Reality:** `services/shared/csvCatalog.js` + `services/catalogIngest.js` import a **product-catalog CSV** into `ProductCatalog` rows (exact SKU lookup exists via `@@index([tenantId, sku])` + `productMatch.js`). UI: `CatalogPanel.js`/`CatalogTable.js`. `fileIngest.js` handles PDF/DOCX/TXT/MD/ZIP for **knowledge**, **no `.xlsx`**.
- **Remaining:** xlsx parser (e.g. SheetJS) + sheet picker/preview/header-confirm UI; per-column include/exclude + price opt-in flags (new `ProductCatalog`/import-config fields); formula evaluation on ingest; re-upload diff (store source filename + row hash, compute added/changed/removed).

### Feature 2 — Load whole catalogue & keep fresh — 🟡 Partial
- **Reality:** `services/shared/crawler.js` (`MAX_PAGES=150`, `MAX_DEPTH`, deadline) + `crawlerBrowser.js` (headless, staff tier). `/scrape` route. No `sitemap.xml` discovery, no plan-tiered caps (200/1k/3k), no `includePath`/`excludePath`, no weekly re-sync job, no "Re-sync now" button, no change-report email.
- **Remaining:** sitemap fetch/parse; plan-tier config on `Tenant`; path filters; a scheduled re-sync worker (cron/queue) + manual endpoint; a diff + email report (reuse `mailer.js`).

### Feature 3 — Image upload in chat — 🟡 Partial (built but **not wired**)
- **Reality:** widget has the attach button, type/size validation, preview, and sends `payload.image` (`tenant-chat-widget.js:120,250,574`). `services/shared/imageGuardrailPipeline.js` + `imageGuardrail.js` implement EXIF/metadata-injection scanning (Tier 1 `sharp`) and vision classification (Tier 3 Groq). **But `runImageGuardrailPipeline` has no caller** — `chatEngine.js`/`tenantChat.js`/routes never consume `body.image`, so the image is dropped server-side.
- **Remaining:** thread `image` through `handleChat` → `runTenantChat` → guardrail → multimodal model; persist attachment refs on `ChatMessage` (new column) for logs + lead alerts; add owner on/off toggle (`Tenant` flag); enforce 3-image cap server-side; EXIF strip on store.

### Feature 4 — Voice chat — ❌ Not started
- No mic button/STT/TTS in the widget; no `channel='voice'`, voice-minute cap, or `"Voice"` tag.
- **Remaining:** widget mic + Web Speech / STT provider; optional TTS; `ChatSession.channel`; monthly voice-minute metering (extend `UsageLog`); Indian-English STT model selection.

### Feature 5 — Escalation to a person — 🟡 Partial
- **Reality:** `engine/ticketing.js` `fileSupportTicket` (kinds `unanswered|outage|human_request|demo_request|contact_request`), pre-LLM confidence gate (`domains/tenantProfile.js` support gate at `minConfidence`), `attachContact` (email), team alert, `/tickets` + `TicketsList.js`, and the new `/tickets/:id/answer` loop.
- **Remaining:** owner-configurable **trigger keywords** (e.g. "complaint"); **phone** capture; **one** ticket spanning both Sales & Support assistants; **expected reply time** from configurable business hours; **Zoho Desk / Freshdesk** sync; richer ticket-status surfacing in chat logs.

### Feature 6 — WhatsApp handoff & channels — ❌ Not started
- No `wa.me` button/confirmation email (6a), no Meta-template rep alert (6b), no Cloud API/BSP inbound/outbound channel (6c).
- **Remaining:** all three; **external blocker:** Meta WhatsApp Business verification + template approval (start early). Reuse knowledge/rules engine; add 24h-window + human-pause state.

### Feature 7 — Drafted first reply for the rep — ❌ Not started
- Only the **buyer receipt** exists. No rep-facing auto-draft (≤1 min), explicit `"[add lead time]"` placeholders, `"Send by email"`/`"Open in WhatsApp"`, or `"Replied"` timestamp.
- **Remaining:** a draft-generation worker (strictly owner content, placeholder insertion for missing facts); draft storage on `Lead`; rep UI with edit + send actions (never auto-send); status transition.

### Feature 8 — Google Sheets & webhooks — ❌ Not started
- **Remaining — Sheets:** Google OAuth (`drive.file`), single-file picker, 1-row-per-lead upsert. **Webhooks:** `Webhook` model (url, events, secret), HMAC signing, event emit on `lead created/updated|chat ended|ticket created`, ~24h retry queue + delivery log with "Send again/test". **External blocker:** Google OAuth app verification.

### Feature 9 — CRM sync (Zoho CRM → HubSpot) — ❌ Not started
- **Remaining:** region-aware Zoho OAuth (`zoho.in`), dedupe/upsert by email+phone, source tag, note with summary + chat link, editable field mapping, two-way status sync, delivery logs/retries; repeat for HubSpot.

### Feature 10 — Connect your email — 🟡 Partial
- **Reality:** `services/tenantSmtp.js` + `TenantSmtpConfig` (custom SMTP incl. Zoho Mail via host), `SmtpSettings.js` UI, `/smtp-config` + `/smtp-config/test`, AES-GCM password, `mailer.js` fallback to global + alert on failure.
- **Remaining:** `Sign in with Google`/`Microsoft` OAuth (send-only scopes), sender name/reply-to/signature, per-email-type toggles (enquiry confirmation / chat summary / drafted replies / ticket updates). **External blocker:** Google OAuth verification (shared with Feature 8).

### Feature 11 — Instructions editor — 🟡 Partial
- **Reality:** `Tenant.persona` + `outOfScopeMessage` + `minConfidence` editable via **staff** `tenantAdmin.routes.js:114`; locked rules are injected **server-side after** owner text already (`engine/promptBuilder.js` — matches the spec's immutability requirement); `BotSandbox` is a live test panel.
- **Remaining:** client-facing per-assistant (Sales vs Support) prompt editors seeded with a default template; tone/length presets; "Reset to default"; version history + "Restore" (new table); side-by-side test wiring.

### Feature 12 — Test & compare AI models — 🟡 Partial
- **Reality:** `BotSandbox` (sandbox-isolated test chat, no live-count pollution — per `7527d77`), `llmClient` model `verify` + provider **failover chain** (groq→openai→anthropic), env-driven model list.
- **Remaining:** a 2–3 model side-by-side playground with latency + cited sources, evaluation checklist, saved test suites (batch run), per-assistant "Use this model" (new `Tenant` fields), staff-curated model list + cost tiers UI, monthly test limits.

### Feature 13 — Appearance — 🟡 Partial
- **Reality:** welcome greeting, up to-4 starter questions (`TenantFaq`), language picker — all in the widget. Colours, bubble icon, logo, name, position are **hardcoded** in `tenant-chat-widget.js`; no live preview; **no** "Powered by KGT Orb" branding exists (so removal is moot); **no** AI notice.
- **Remaining:** appearance config model + `/appearance` API; widget reads config (colours with auto-contrast + low-contrast warning, icon/logo/position/name); desktop/mobile live preview; branding line + paid removal toggle; **non-removable AI notice (ties to Step 0.3)**.

### Feature 14 — Auto-open after a delay — ❌ Not started
- **Remaining:** widget open-delay (off by default, 5–60s, once per visit, respect dismissal, desktop-default + mobile mini-bubble, optional URL-path filter); config fields.

### Feature 15 — Visitor feedback — ❌ Not started
- **Remaining:** thumbs up/down per answer (widget) + reasons; `ChatMessage.feedback`/reason columns; chat-logs filter + "To review" queue + weekly counter (extend `ImprovementsPanel`).

### Feature 16 — Chat logs — 🟡 Partial
- **Reality:** `SessionsPanel.js` + `GET /sessions`, `GET /sessions/:id` transcript, `ImprovementsPanel.js` + `GET /improvements` (weak/unanswered queue), leads + tickets surfaced; filter by `botType`; summaries.
- **Remaining:** `channel` facet (website/voice/whatsapp — needs `ChatSession.channel`); feedback/thumbs-down, paused, spam facets; keyword/email/phone search; per-turn model/latency/sources + image rendering in the transcript; row actions (mark reviewed, private note, pause/resume Orb, create ticket); filtered CSV export (ties to Step 0.2); retention TTL + single-chat/visitor RTBF deletion; explicit RBAC gating.

### Feature 17 — Guardrails — 🟡 Partial
- **Reality:** per-tenant chat rate limit (`tenantChat.js`), monthly token budget (`usageTracking.isTenantOverBudget`), prompt-injection scanning (`imageGuardrailPipeline.js`, `promptBuilder.js`), image guardrail (unwired).
- **Remaining:** unified Guardrails settings screen; configurable "N messages / N seconds" **per device** (`browserId`+IP) + custom limit-reached message; toggleable **spam** check at visitor messages #2/#4/#8/#16 with auto-pause (+ `ChatSession.status`/`spam` flags + manual pause/resume); **country blocking** multi-select + IP geo-block in the widget loader and chat route.

---

## 4. Feature 18 — Orb Copilot
❌ **Not started — Deferred.** No scaffolding (no routes, services, models, or UI). Per the spec, this is explicitly **deferred until Features 1–17 are live**; no work should begin now.

---

## 5. Recommended Execution Roadmap (Build Order Steps 0 → 4)

> ⏱️ **Start external verifications on day one** — they gate later steps:
> **Google OAuth app verification** (Features 8 & 10) and **Meta WhatsApp Business verification + template approval** (Feature 6) both have multi-week external lead times.

### Step 0 — Finish the Fix Sprint (highest priority, mostly small)
1. **0.3 AI notice + consent** — add a non-removable disclosure line to the widget + a chat-consent `TenantConsent` kind. *Unblocks the "AI notice cannot be turned off" locked rule and Feature 13.*
2. **0.2 CSV export** — `GET /leads/export.csv` + `/sessions/export.csv` (filtered), streamed with `Content-Disposition`. *Reused by Feature 16.*
3. **0.4 Allowed domains + per-device rate limit** — `Tenant.allowedDomains`, `Origin` check in `tenantChat.routes.js`; add a `browserId`+IP bucket to the limiter. *Foundation for Feature 17.*
   *(0.1, 0.5, 0.6, 0.7 already done.)*

### Step 1 — Core Base (owner control + visibility; no external deps)
- **Feature 3** — wire the existing image pipeline into the chat turn + persist + owner toggle (fast win; code already written).
- **Feature 11** — client instructions editor (+ version history), building on `persona` + the existing after-text locked-rule injection.
- **Feature 13** — appearance config + widget theming + live preview + branding removal.
- **Feature 15** — thumbs feedback end-to-end.
- **Feature 16** — enrich chat logs (facets, search, per-turn metadata, actions, retention/RTBF) on top of Step 0.2 export.
- **Feature 17** — unified Guardrails screen (per-device limit, spam auto-pause, country block).

### Step 2 — Pilot Essentials (richer ingest + conversion, still mostly internal)
- **Feature 1** — Excel/CSV rich upload workflow.
- **Feature 2** — catalogue freshness (sitemap, tiers, path filters, weekly re-sync, change report).
- **Feature 5** — complete escalation (keywords, phone, cross-assistant ticket, business-hours ETA).
- **Feature 7** — rep drafted first reply (human-approved send).
- **Feature 12** — model playground.
- **Feature 14** — auto-open.
- **Feature 4** — voice chat.
- **Feature 10** — email OAuth (**needs Google verification from day one**).

### Step 3 — Connected Workflows (external APIs, OAuth-gated)
- **Feature 8** — Google Sheets (**Google verification**) + webhooks (HMAC + retry + delivery log).
- **Feature 9** — CRM sync (Zoho CRM region-aware OAuth, then HubSpot).

### Step 4 — External Channels & CRMs (heaviest external approvals)
- **Feature 6** — WhatsApp handoff + channels (**Meta WhatsApp Business verification + template approval**).

### Step 5 — Deferred
- **Feature 18** — Orb Copilot, only once 1–17 ship.

---

### Operational note (carried from prior work)
The `widget_telemetry` migration (`0fbb2fc`) and all future schema work must be applied with
`cd apps/api && npx prisma migrate deploy` before deploy / `test:db`; the regenerated Prisma
client expects the new columns. Unit/integration suites mock Prisma and won't catch a
missing migration.
