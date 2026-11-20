# 🔀 KGT Orb V2 — Three-Way Merged Audit (`origin/main` × `aakarsh/improvement` × Spec)

> Authoritative, code-grounded comparison against **KGT Orb: Final Features to Build (V2, 26 Oct 2026)**.
> Verified read-only via `git ls-tree` / `git grep` / `git show` against `origin/main` (`f905b05`) and the
> current branch `aakarsh/improvement` (`HEAD 1203770`, working tree clean except untracked audit docs).
> No `git checkout` was run; no working-tree files were modified other than this report.
> `/tmp/kgt_main_audit` was absent, so `origin/main` was inspected directly from the object store.

---

## 1. Branch Delta & Architectural Overview

### ⚠️ Headline: the two branches have **diverged**, each shipping *different* halves of V2
`git diff --stat origin/main..HEAD` = **144 files changed, +4,911 / −11,396**. Those ~11k "deletions"
are **features that exist on `origin/main` but are absent from this branch's tree** (53 whole files,
listed below) — not lines this branch removed from shared files. The branch forked before/around
`20261028` (`product_url`) and went its own way.

**`git log origin/main..HEAD` (7 commits unique to the branch):**
`1203770` figma change · `7527d77` ticket-answer/audit hardening · `0fbb2fc` widget telemetry ·
`48c94b2` Phase C (bots redirect + advisory) · `2b36fc0` Phase B/A (ticket→FAQ + auto re-audit) ·
`bb9c190` backend hardening · `f88da60` improvement.

**`git log HEAD..origin/main` (commits unique to main):**
`f905b05` run an attached photo through the image guardrail · `c70d610` complete bot branding, logo
background removal, security hardening · `6a9ccee` Zoho connect test · `6c4f790` fsevents chore.

### What `origin/main` has that this branch does **NOT** (53 deleted files — a merge-regression risk)
| Area | Evidence on main (absent on branch) |
|---|---|
| **CRM sync (F9)** | `services/crm/{zohoAuth,zohoSync,crmSettings}.js`, `routes/crmOAuth.routes.js`, `routes/crmWebhook.routes.js`, `components/workspace/CrmIntegrations.js`, `pages/dashboard/integrations.js`, schema `TenantCRMIntegration`/`CRMSyncLog`/`CRMProvider`/`CRMSyncStatus`, migration `20261104090000_crm_integration` |
| **Branding / Appearance (F13)** | `services/branding.js`, `services/shared/{brandExtractor,color,logoAnalyzer,logoUpload,themeGenerator}.js`, `routes/brandAssets.routes.js`, `components/workspace/BrandingStudio.js`, `pages/dashboard/branding.js`, schema `TenantBranding`/`TenantLogoAsset`, migrations `20261111…`,`20261112…bot_name`,`20261115/16/17…logo` |
| **Allowed-origins / domain allowlist (Step 0.4)** | `allowedOrigin` in `routes/tenantChat.routes.js`, `routes/tenantWorkspace.routes.js`, `utils/tenantApiKeys.js`, `components/workspace/KeyVault.js`, migration `20261114090000_api_key_allowed_origins` |
| **Voice STT (F4)** | `services/shared/speechToText.js` + wiring in `routes/tenantChat.routes.js`, `tenantWorkspace.routes.js`, unit test `speechToText.test.js` |
| **Image guardrail WIRED (F3)** | `tenantChat.js` calls `runImageGuardrailPipeline(...)` (commit `f905b05`) — on this branch the pipeline exists but has **no caller** |
| **Network guard (F17)** | `services/shared/netGuard.js` (+ test) — SSRF/egress guard |
| **Lead CRM indexing** | migrations `20261113…lead_crm_record_index`, `20261114100000_lead_unique_capture` |

### What this branch has that `origin/main` does **NOT**
| Area | Evidence on branch (absent on main) |
|---|---|
| **Sandbox isolation** | `ctx.sandbox` in `tenantChat.js`/`ticketing.js`, `test/unit/sandboxIsolation.test.js` — **main still writes test chats to production tables and can file real tickets from the dashboard test chat** |
| **Ticket→FAQ "Add the answer" loop** | `POST /tickets/:id/answer` (idempotent), `answerTicket` in `TicketsList.js`/`api.js`, `ticketAnswer.test.js` |
| **Auto readiness re-audit + cooldown** | `scheduleTenantAudit` on every doc mutation + cooldown/trailing-pass, `botAuditorSchedule.test.js`, `docRouteAudit.test.js` |
| **Widget install telemetry** | `widgetSeenAt`/`widgetUrl`, `POST …/ping`, `GET /install-status`, `widgetTelemetry.test.js`, migration `20261119090000_widget_telemetry` |
| **Onboarding polish** | `SignupWelcome.js`, land-on-`/dashboard/bots`, single-category advisory |
| **Retrieval / ops migrations** | `20261117090000_pgvector_hybrid`, `20261117100000_operator_revocation`, `20261117110000_tenant_token_budget` |

### Migration & environment prerequisites
- **Conflicting migration timelines.** Main's chain runs `…20261104_crm → 20261117_logo`; the branch's runs `…20261117_pgvector/operator/token_budget → 20261119_widget_telemetry`. Both descend from `…20261028_product_url`. A reconciliation (merge main → branch, or cherry-pick) must **interleave both sets** and run `prisma migrate deploy` for the union; neither tree can simply overwrite the other's `prisma/migrations`.
- **Branch:** `20261119090000_widget_telemetry` must be applied (`cd apps/api && npx prisma migrate deploy`) before deploy / `test:db`; the generated client expects `TenantApiKey.widgetSeenAt`/`widgetUrl`.
- **Main:** CRM OAuth needs Zoho app creds + region (`zoho.in`); branding/logo needs image-processing deps (`sharp`); `speechToText` needs an STT provider key.

### Net recommendation
Treat the branch as **not directly mergeable to `main`**: a naive merge that favors the branch would **delete shipped Features 4, 9, 13, Step 0.4, the wired image guardrail, and netGuard**. The correct path is to **merge `origin/main` into `aakarsh/improvement`** (or cherry-pick the branch's 7 feature commits onto `main`), reconciling the two migration chains, so the union keeps *both* main's CRM/branding/voice/allow-list/image-wiring **and** the branch's sandbox isolation, feedback loop, auto re-audit, and telemetry.

---

## 2. Master Comparison Matrix

Legend: ✅ Done · 🟡 Partial · ❌ Not started. "Shared" = present on both (pre-divergence common base).

### Step 0 — November Fix Sprint
| Spec Item | `origin/main` | `aakarsh/improvement` | Delta on this branch |
|---|:--:|:--:|---|
| 0.1 Email alert on every lead | ✅ | ✅ | Shared (`teamAlerts.js`) |
| 0.2 CSV export (leads/chats) | ❌ | ❌ | Neither — both only export the catalog **template** |
| 0.3 AI notice + consent record | ❌ | ❌ | Neither (no "chatting with an AI" string; `TenantConsent` = crawl only) |
| 0.4 Allowed domains + per-visitor limit | 🟡 | ❌ | **Main leads:** API-key allowed-origins + enforcement + UI. Per-device limit absent on both; branch has only the per-tenant limit |
| 0.5 Price rule | ✅ | ✅ | Shared (`tenantProfile.js` grounding) |
| 0.6 Replace retiring models | ✅ | ✅ | Shared (`llmClient.js`) |
| 0.7 New email service | ✅ | ✅ | Shared (`mailer.js`: SMTP + Resend) |

### Locked Rules
| Rule | `origin/main` | `aakarsh/improvement` | Delta |
|---|:--:|:--:|---|
| AI notice can't be turned off | ❌ | ❌ | Notice doesn't exist on either (blocked on 0.3) |
| Strict grounding + price rule | ✅ | ✅ | Shared |
| Human-in-the-loop (no auto-send to buyer) | ✅ | ✅ | Shared — only an acknowledgment receipt is auto-sent |
| Secrets encrypted/hashed | ✅ | ✅ | Shared (`encryption.js`, hashed keys/OTP/passwords) |
| RBAC respected | ✅ | ✅ | Shared |
| Zero "DPDP/GDPR compliant" copy | ✅ | ✅ | Clean on both (only a `.gdpr` CSS selector in `crawler.js`) |

### Features 1–18
| # | Feature | `origin/main` | `aakarsh/improvement` | Delta / what changed on the branch |
|---|---|:--:|:--:|---|
| 1 | Excel & CSV upload | 🟡 | 🟡 | Shared CSV-catalog importer; no `.xlsx`/sheet-picker/price-opt-in/formula/diff on either |
| 2 | Whole catalogue + keep fresh | 🟡 | 🟡 | Shared crawler (raised limits); no sitemap/tiers/path-filters/re-sync/change-report on either |
| 3 | Image upload in chat | 🟡 (**wired**) | 🟡 (**unwired**) | **Main leads:** `f905b05` runs the attached photo through the guardrail in `tenantChat.js`. Branch has the UI + pipeline but **no caller** |
| 4 | Voice chat | 🟡 | ❌ | **Main leads:** `speechToText.js` + route wiring (STT backend). Branch has nothing |
| 5 | Escalation to a person | 🟡 | 🟡 | Shared ticketing + confidence gate. **Branch adds** the ticket→FAQ answer loop + auto re-audit; neither has trigger-keywords, phone, cross-assistant single ticket, business-hours ETA, or Desk/Freshdesk |
| 6 | WhatsApp handoff & channels | ❌ | ❌ | Neither |
| 7 | Drafted first reply for rep | ❌ | ❌ | Neither (only the buyer receipt exists) |
| 8 | Google Sheets & webhooks | 🟡 | ❌ | **Main leads:** CRM two-way **webhook** infra (`crmWebhook.routes.js`, HMAC/retry patterns). No Google Sheets on either; main's webhooks are CRM-scoped, not the generic lead/chat/ticket events |
| 9 | CRM sync (Zoho → HubSpot) | 🟡 | ❌ | **Main leads:** full Zoho OAuth + upsert/sync + settings + two-way status + `CrmIntegrations` UI + logs (`CRMSyncLog`). HubSpot still pending. Branch has none |
| 10 | Connect your email | 🟡 | 🟡 | Shared custom SMTP (incl. Zoho Mail) + test + encryption; no Google/Microsoft OAuth or per-type toggles on either |
| 11 | Instructions editor | 🟡 | 🟡 | Shared single `persona` (staff-only) + after-text locked-rule injection; no client editor/versioning/presets on either |
| 12 | Test & compare AI models | 🟡 | 🟡 | Shared `BotSandbox` + model-verify + failover. **Branch adds** sandbox isolation so the test playground can't pollute live counts; no side-by-side playground on either |
| 13 | Appearance | 🟡 (**substantial**) | 🟡 (**minimal**) | **Main leads:** `branding.js` + logo upload/analyzer + `themeGenerator`/`color` (auto-contrast) + `BrandingStudio` + bot name. Branch widget is hardcoded (welcome + starter Qs only) |
| 14 | Auto-open after delay | ❌ | ❌ | Neither |
| 15 | Visitor feedback (thumbs) | ❌ | ❌ | Neither |
| 16 | Chat logs | 🟡 | 🟡 | Shared `SessionsPanel` + transcript. **Branch adds** `ImprovementsPanel` + sandbox-clean logs; main's can tag a `voice` channel. Neither has full facets/search/per-turn-metadata/CSV export/retention/RTBF |
| 17 | Guardrails | 🟡 | 🟡 | **Main leads:** allowed-origins + `netGuard` (SSRF) + wired image guardrail. **Branch has** rate limit + token budget + (unwired) image guardrail. Neither has the unified screen, per-device limit, spam auto-pause, or country blocking |
| 18 | Orb Copilot | ❌ | ❌ | Deferred per spec on both |

---

## 3. Detailed Gap & Action Breakdown

### A. Already DONE on `origin/main` (and that this branch must re-absorb, not overwrite)
- **Feature 9 — Zoho CRM** (OAuth, upsert by email/phone, source tag, note with summary+chat link, two-way status via `crmWebhook`, `CrmIntegrations` UI, `CRMSyncLog` retries). *Remaining on main:* HubSpot.
- **Feature 13 — Appearance/branding** (logo upload + background removal, theme/colour generation with contrast, bot name, `BrandingStudio`). *Remaining:* widget-side live preview parity, non-removable AI notice, "Powered by" removal toggle.
- **Step 0.4 — Allowed-origins** (per-API-key origin allowlist enforced in the chat route + KeyVault UI). *Remaining:* per-device (`browserId`+IP) rate limit.
- **Feature 4 — Voice STT backend** (`speechToText.js`). *Remaining:* widget mic UI, TTS, voice-minute cap, `"Voice"` channel tag.
- **Feature 3 — Image guardrail WIRED** into the chat turn. *Remaining:* owner on/off toggle, persistence in logs/lead alerts, 3-image cap.
- **Feature 8 (partial) — CRM webhooks** (HMAC/retry groundwork reusable for the generic lead/chat/ticket webhooks).
- **Feature 17 (partial) — netGuard** egress/SSRF protection.

### B. Already DONE on `aakarsh/improvement` (and that main is missing)
- **Sandbox isolation** — the single most important correctness gap on main: main's dashboard test chats write `chat_sessions`/`chat_messages` and can file **real tickets**. The branch fixes this (`ctx.sandbox`), with tests.
- **Ticket→FAQ "Add the answer" loop** — idempotent `POST /tickets/:id/answer` (in-transaction conditional claim) + UI.
- **Auto readiness re-audit** on every knowledge change, with a per-tenant cooldown + one trailing pass (cost-safe), + zero-doc guard.
- **Widget install telemetry** — `/ping` + `/install-status` + `KeyVault` poll.
- **Onboarding** — `SignupWelcome` one-time key handoff, land-on-Test-Bots, single-category advisory.
- **Retrieval/ops** — pgvector hybrid retrieval, operator token revocation, per-tenant token budget.

### C. Still REMAINING across the spec (on both — net new build)
Step 0.2 (CSV export), 0.3 (AI notice + consent), 0.4 per-device limit; Features 6 (WhatsApp), 7 (drafted reply), 14 (auto-open), 15 (thumbs feedback); the un-built remainder of 1 (xlsx workflow), 2 (sitemap/re-sync), 5 (keywords/phone/cross-assistant/ETA/Desk), 8 (Google Sheets + generic webhooks), 9 (HubSpot), 10 (email OAuth + toggles), 11 (client editor + versioning), 12 (side-by-side playground), 13 (widget preview + AI notice), 16 (facets/search/per-turn metadata/export/retention/RTBF), 17 (unified screen + per-device limit + spam auto-pause + country block); Feature 18 (deferred).

### D. Remaining work mapped to the spec build order (post-reconciliation)
> **Step −1 (do first): reconcile the branches.** Merge `origin/main` into `aakarsh/improvement`, interleave the two migration chains, and run the union test suite. Nothing below is safe until main's CRM/branding/voice/allow-list/image-wiring and the branch's sandbox/feedback/telemetry coexist.

- **Step 0 — Fix Sprint:** 0.3 AI notice + chat-consent record; 0.2 leads/chats CSV export; 0.4 per-device rate limit (main already has the domain allowlist). *(0.1/0.5/0.6/0.7 done; 0.4 half-done on main.)*
- **Step 1 — Core Base:** finish Feature 3 (owner toggle + persistence on main's wired pipeline); Feature 13 (widget preview + non-removable AI notice + branding-removal toggle on top of main's branding); Feature 15 (thumbs); Feature 16 (facets/search/per-turn metadata/export/retention/RTBF); Feature 17 (unified Guardrails screen: per-device limit, spam auto-pause, country block — reuse `netGuard`); Feature 11 (client instructions editor + versioning); Feature 12 (side-by-side playground on the isolated sandbox).
- **Step 2 — Pilot Essentials:** Feature 1 (xlsx workflow); Feature 2 (sitemap/tiers/path-filters/weekly re-sync/change report); Feature 5 (keywords, phone, cross-assistant ticket, business-hours ETA); Feature 7 (rep drafted reply); Feature 4 (widget mic/TTS on main's STT); Feature 14 (auto-open); Feature 10 (email OAuth + per-type toggles).
- **Step 3 — Connected Workflows:** Feature 8 (Google Sheets + generic webhooks, reusing main's CRM HMAC/retry); Feature 9 (HubSpot, after main's Zoho).
- **Step 4 — External Channels:** Feature 6 (WhatsApp handoff + channels).
- **Deferred:** Feature 18 (Orb Copilot) once 1–17 ship.

### ⏱️ External lead-time blockers (start on day one)
- **Google OAuth app verification** — Feature 10 (email) **and** Feature 8 (Google Sheets).
- **Meta WhatsApp Business verification + template approval** — Feature 6.
- **Zoho** is already integrated on main; **HubSpot** app registration is the next CRM external step.
