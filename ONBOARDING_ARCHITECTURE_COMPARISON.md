# 🏗️ End-to-End Onboarding & Runtime Architecture: Spec vs. Project Implementation

> A synthesis of the nine-step spec-conformance audit of the KGT AI Hub onboarding and
> runtime lifecycle. Each step compares the **architectural specification** against the
> **actual project implementation**, verdicts each rule, and ends with a prioritized
> engineering roadmap to "perfect working" without abandoning our architecture.

---

## 1. Executive Summary: The Core Architectural Trade-off

- **The Spec's Design:** A **multi-phase state machine**. State advances through explicit
  database columns — `onboarding_step` on the tenant, `status` on documents (`draft` →
  `active`), and a multi-stage tenant lifecycle (`onboarding` → `ready_to_install` →
  `live`, with a `liveAt` timestamp). Each wizard step writes incrementally to the
  database, so a half-finished signup leaves real rows behind.

- **Our Project's Design:** A streamlined, atomic **single-phase transactional model**.
  The entire wizard — company details, knowledge, audit results, consent, dismissed
  requirements — is held in **client memory** and committed in **one
  `prisma.$transaction` at `POST /complete`**. There is no `onboarding_step`, no document
  `status`, and no `liveAt` lifecycle column. A tenant row exists only once the account is
  fully provisioned; email verification is reconciled *inside* the same transaction via
  `claimVerification`.

- **Verdict:** Our single-phase approach **eliminates database clutter and partial
  "limbo" states** — there are no orphaned draft tenants, no stuck half-states to garbage
  collect, and finalization is ACID. It **diverges** from the spec's state-tracking and
  lifecycle models, which means a handful of spec features that *depend* on those columns
  (install-status polling, an explicit `live` transition, draft-document editing on the
  server) are intentionally absent or handled differently. **The core business logic that
  matters — OTP security, rate limiting, consent capture, slug uniqueness, pillar-weighted
  scoring, ACID finalization, and confidence gating — is correct and well-built.** The
  remaining gaps are either deliberate architectural choices or small, self-contained
  features that can be added *on top of* the single-phase model.

---

## 2. Step-by-Step Comprehensive Comparison (Steps 1 – 9)

### Step 1 — Account Creation & OTP Verification

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Email OTP for account verification | `EmailVerification` model: `codeHash`, `expiresAt`, `attempts`, `verified`, `usedAt`, `lastSentAt` | ✅ Match |
| OTP hashed at rest (no plaintext codes) | **HMAC-SHA256** of the code; constant-shape compare | ✅ Match (strong) |
| Short expiry window | **10-minute TTL** (`expiresAt`) | ✅ Match |
| Rate-limit OTP sends | `lastSentAt` throttle on resend | ✅ Match |
| Brute-force protection on verify | **Atomic attempt-claim before compare** (increment `attempts` first, then compare) — no TOCTOU window | ✅ Match (strong) |
| Signup session token after verify | `'signup'` JWT, **2-hour** validity | ✅ Match |
| Atomic account creation | Deferred — account is created later, at `/complete`, inside one transaction | ✅ By design (single-phase) |

**Analysis.** Step 1 is a security highlight. The atomic attempt-claim (increment the
counter *before* comparing the code) closes the classic OTP brute-force race, and HMAC
(not a bare hash) over the code resists precomputation. Verification state lives in
`EmailVerification` and is reconciled into the final transaction via `claimVerification`,
so a verified email can't be double-spent. No defects.

---

### Step 2 — Company Details & Slug Generation

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Collect company name | Required field | ✅ Match |
| Collect contact name | Optional field | ✅ Match (relaxed) |
| Collect industry / category | `businessCategory` captured, drives category-aware audit | ✅ Match |
| Unique tenant slug with random suffix | `makeSlug = \`${base}-${randomBytes(3).hex}\`` | ✅ Match |
| Distinguish slug collision from duplicate email | `violatedTargets(e)` inspects `error.meta.target`; slug-only `P2002` re-rolls the suffix and retries (×3), `signupEmail` → `ACCOUNT_EXISTS` | ✅ **Resolved (was G1)** |

**Analysis.** Slug generation is robust — a 3-byte random suffix makes collisions
vanishingly unlikely, and `signupEmail` has its own unique constraint. **Step 2 G1 is now
resolved.** The `/complete` catch calls `violatedTargets(e)` to read `error.meta.target`
(array of fields *or* a constraint name, both matched by `/slug/i` and `/email/i`): a
slug-only clash re-rolls `makeSlug` and retries inside a `MAX_SLUG_RETRIES = 3` loop (503
only if it somehow exhausts), while an `signupEmail` violation — or an unknown index,
treated conservatively — returns `ACCOUNT_EXISTS`. The misleading "account already exists"
message on a random-suffix clash is gone. Covered by `test/unit/registerSlugConflict.test.js`.

---

### Step 3 — Knowledge Ingestion & Document Management

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Website crawling for knowledge | Crawler service ingests pages into documents | ✅ Match |
| **Consent enforcement** before crawling | `TenantConsent` captured (`domain`, `statement`, `statementVersion`, `email`, `ip`, `ua`) and written in the finalize transaction | ✅ Match (strong, auditable) |
| File upload: size/type parsing | Parsed client-side into document entries | ✅ Match |
| Manual / written entries | Supported as document entries | ✅ Match |
| Draft documents on the server (draft → active) | **No `status` column**; documents live in client state until `/complete`, then created `active` | ✅ By design (single-phase) |
| Per-document bot scope | `botScope` on `TenantDocument` | ✅ Match |
| "Check your categories" advisory when all entries share one category | `KnowledgeUploadStep.js`: a dismissible amber banner when >1 entry and all share one category | ✅ **Resolved (was G1)** |

**Analysis.** Ingestion captures a strong, legally-useful consent record (statement
*version*, IP, UA, timestamp) — better than the spec's minimum. The absence of
server-side draft documents is the single-phase model working as intended: there is no
draft table to reconcile because nothing is persisted until finalize. **Step 3 G1 is now
resolved**: when more than one entry is present and they all share a single category, the
wizard's "Your knowledge" card shows a dismissible amber advisory ("All your knowledge is
filed under X — add a few entries under the other types so both bots have what they need").
Pure client-side; advice, never a gate.

---

### Step 4 — Training & Bot Readiness Evaluation

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Pre-flight audit before launch | `POST /preflight-audit` → `auditTenant` / `auditKnowledge` | ✅ Match |
| Rate-limit the audit (it calls an LLM) | `isAuditRateLimited`: **12 / 10 min** | ✅ Match |
| Content hashing to detect staleness | `contentHash` on the saved report; mismatch ⇒ "Documents changed · Check again" | ✅ Match |
| Multi-bot scoring | Pillar-weighted per bot; **overall = min across deployed bots** | ✅ Match |
| Readiness threshold | `READY_AT = 80`, `MODERATE_AT = 50` | ✅ Match |
| Category-aware recommendations | `CATEGORY_REQUIREMENTS` × pillar, `businessCategory`-tailored copy | ✅ Match (enhanced) |
| Interactive gap dismissal + instant re-score | `requirementItems` (enriched, keyed per item) + `recomputeReadiness` (earned ÷ adjusted-max × 100) | ✅ Match (enhanced) |

**Analysis.** This step is the most feature-rich and fully conformant. Scoring is
pillar-weighted (five pillars — identity / features / pricing / support / sales — with
per-bot `BOT_WEIGHTS` summing to 100), capped by a content cap so you can't score past
"too little content." The **dismissible-requirements** system is the standout: each
displayed gap is enriched (`description` / `importance` / `botUtility`), classified to a
pillar, and individually dismissible; dismissing removes that item's share of its pillar's
shortfall from the score's *maximum* (`score = earned / adjustedMax × 100`) so the % rises
instantly client-side and the backend runs the identical formula on persist. Covered by
`dismissibleRequirements.test.js` and `categoryRequirements.test.js`. No defects.

---

### Step 5 — Review & Workspace Creation

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Review summary screen before commit | `StepReview` shows company, bots, counts, scores; amber warning under 80% | ✅ Match |
| Final commit is atomic (ACID) | One `prisma.$transaction` at `/complete`: tenant + apiKey + documents + consent + user | ✅ Match (strong) |
| Dismissed requirements persisted at launch | `/complete` accepts `ignoredRequirements`, applies `recomputeReadiness` before `saveTenantReadiness` | ✅ Match |
| Finalize rate-limit | `isCompleteRateLimited`: **3 / hour** | ✅ Match |
| Background jobs kick off on completion | `scheduleTenantAudit` invoked at finalize | ✅ Match |
| Post-completion routing | `router.push('/dashboard/bots')`; the show-once key + embed snippets render there via `SignupWelcome` | ✅ **Resolved (was G1)** |

**Analysis.** Finalization is the heart of the single-phase design and it is correct: the
tenant, its first API key, all documents, the consent record, and the owner user are
created in **one transaction**, with `claimVerification` reconciled inside it — so either a
fully-formed workspace exists or nothing does. There is no window for a partially-created
tenant. **Step 5 G1 is resolved**: finalize now lands the new client on `/dashboard/bots`
(the natural first action is to try the bots), and the show-once API key + embed snippets
are shown there by a shared `SignupWelcome` component — it consumes the one-time
sessionStorage handoff on whichever dashboard page loads first (also mounted on
`/dashboard` as a fallback), so the key still surfaces exactly once despite the new route.

---

### Step 6 — Test Bots Sandbox & Evaluation

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Side-by-side RAG playground | Dashboard test-chat UI | ✅ Match |
| Language toggles | Supported | ✅ Match |
| **Sandbox test chats must NOT pollute production data** | `runTenantChat({ sandbox })` synthesizes an unpersisted session and **skips** all `chatSession`/`chatMessage` writes, `recordTurn` and `trackLeadActivity` | ✅ **Resolved (was G1)** |
| Sandbox tests must NOT create live support tickets | `ctx.sandbox` is threaded into the engine; `engine/ticketing.js` returns `null` on `ctx.sandbox` before any `fileSupportTicket` write | ✅ **Resolved (was G1)** |

**Analysis.** This was flagged as the highest-severity finding, and it is now **resolved**.
The `sandbox` flag (`sandbox: !!req.actor` in `handleChat`) is threaded all the way through
`runTenantChat` into the engine `ctx`. When true: the turn runs against a synthetic
`sandbox-<uuid>` session, **no** `chat_sessions`/`chat_messages` rows are written, history
reads are skipped, `recordTurn` / `trackLeadActivity` / team alerts are skipped, and
`engine/ticketing.js` short-circuits (`if (ctx.sandbox) return null`) **before** filing a
ticket — not merely suppressing the alert. The full engine still runs for a faithful test;
only the writes are elided. Owner tests can no longer inflate analytics, pollute transcripts,
or raise phantom tickets. Covered by `test/unit/sandboxIsolation.test.js`.

---

### Step 7 — Install & Widget Integration

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| API key issuance | `POST /api-keys`; `tk_${randomBytes(24).hex}` | ✅ Match |
| **SHA-256 key hashing** at rest | `keyHash` = SHA-256; plaintext shown once | ✅ Match (strong) |
| Key prefix for identification | `keyPrefix` = `tk_` + 6 hex | ✅ Match |
| Dual code snippets (per bot) | `KeyVault.js` renders two per-bot install snippets + show-once warning | ✅ Match |
| Widget **ping telemetry** (`/ping`) | Not present | ⚠️ **Gap (G1, optional)** |
| **Install-status polling** (30s, has the widget loaded?) | Not present — no `widgetSeenAt` column | ⚠️ **Gap (G2, optional)** — requires schema addition |

**Analysis.** Key management is textbook: the plaintext key is shown exactly once, only a
SHA-256 hash is stored, and a short prefix allows identification without exposing the
secret. The two missing pieces (**Step 7 G1/G2**) are telemetry niceties — a `/ping`
endpoint the widget calls on load, and a dashboard poll that flips the UI to "widget
detected." Both are genuinely useful but **require a schema change** (`widgetSeenAt` /
`widgetUrl` on `TenantApiKey`), so they sit at low priority and are the one place the
single-phase model's lack of a `status` lifecycle is felt.

---

### Step 8 — Live First Visitor Chat & Tenant Lifecycle

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| Public widget chat endpoint | `POST /chat` → `handleChat` → `runTenantChat` | ✅ Match |
| `X-Tenant-Api-Key` authentication | `clientAuth` middleware verifies the key hash | ✅ Match |
| Per-workspace rate limiting | `isTenantRateLimited`: **300 / 10 min** per `tenant.id` | ✅ Match |
| Full telemetry logging | `chatSession` + `chatMessage.createMany` on every exchange | ✅ Match |
| Explicit tenant lifecycle (`onboarding`→`ready_to_install`→`live`) + `liveAt` | **No lifecycle columns**; a tenant is simply `active` from finalize onward | ✅ By design (single-phase) |

**Analysis.** The live chat path is solid: keys are authenticated by hash lookup,
rate-limited per tenant, and every exchange is persisted for analytics and the feedback
loop. The spec's multi-stage lifecycle (`onboarding` → `ready_to_install` → `live` with a
`liveAt` stamp) is **intentionally collapsed**: because finalization is atomic, a tenant is
"live" the instant the transaction commits — there is no meaningful intermediate state to
model. This is the single-phase trade-off working as designed. (The earlier caveat — that shared
`runTenantChat` let dashboard tests contaminate this telemetry — no longer applies now that
Step 6 G1 is resolved: sandbox turns persist nothing, so everything logged here is a real
visitor exchange.)

---

### Step 9 — Support Tickets, Handoffs & the "Add the Answer" Feedback Loop

| Spec Rule | Project Implementation | Status / Verdict |
|---|---|---|
| **Support** bot: answer only ≥ threshold, else bypass LLM → handoff | `minConfidence: tenant.minConfidence` (default 0.30); `gateFailed` returns fallback + files ticket **before** the LLM call | ✅ Match (spec-perfect) |
| **Sales** bot: sections reach the model, threshold decides handoff vs. clarify | No `minConfidence` gate; `handoffBelow: tenant.minConfidence`; post-LLM decision | ✅ Match (spec-perfect) |
| Support ticket on unanswered / human request | `fileSupportTicket({ kind })` — `unanswered\|outage\|human_request\|demo_request\|contact_request` | ✅ Match |
| Contact capture onto an open ticket | `attachContact` sets `contactEmail` on the open ticket | ✅ Match |
| Lead tracking + async summary | `Lead` model (`chatSummary`, `summaryStatus`, `fullTranscript`); async summaries | ✅ Match |
| **"Add the answer" loop:** `POST /tickets/:id/answer` → FAQ doc, close ticket, clear cache, re-check | `POST /tickets/:id/answer`: in one `$transaction` creates the document + sets ticket `answered`; then `invalidateTenantKnowledge` + `scheduleTenantAudit` | ✅ **Resolved (was G1)** |
| Ticket status → `answered` on resolution | The answer route flips `status` to `'answered'` in the same transaction as the document create | ✅ **Resolved (was G1)** |
| "Add the answer" button pre-filled with the question | `TicketsList.js`: per-open-ticket "Add the answer" → inline form (question shown, answer + category) → `ws.answerTicket` | ✅ **Resolved (was G1)** |
| **Automatic readiness re-check** after knowledge changes | Every document mutation (`POST /documents`, `/documents/file`, `/documents/pdf`, `PATCH`/`DELETE /documents/:id`, `/scrape`) now fires `scheduleTenantAudit` after `invalidateTenantKnowledge` | ✅ **Resolved (was G2)** |

**Analysis.** The *hard* part of Step 9 is done and done well. The **dual confidence
model** is spec-perfect: the **Support** profile gates **pre-LLM** (below 0.30 it never
calls the model — it returns the fallback and files a ticket, saving tokens on questions it
can't answer), while the **Sales** profile lets sections reach the model and only *then*
decides between a handoff and a clarifying reply. Typed ticket `kind`s, later-contact
attachment, and lead upsert with async summaries are all in place.

The **last mile of the feedback loop (Step 9 G1)** is now **resolved**. `POST
/tickets/:id/answer` turns an unanswered ticket into a published knowledge document and marks
the ticket `answered` in a **single `prisma.$transaction`** (consistent with the single-phase
ethos); after commit it clears the RAG cache (`invalidateTenantKnowledge`) and schedules a
readiness re-audit (`scheduleTenantAudit`). The route is tenant-scoped, defaults the document
to the `FAQ` category, enforces `roomForDocuments`, and refuses a ticket that is already
answered. `TicketsList.js` adds a per-open-ticket **"Add the answer"** button opening an inline
form (the question shown for context, the answer and category captured) wired to
`ws.answerTicket`. Covered by `test/integration/ticketAnswer.test.js`.

**Step 9 G2** is also **resolved**: every knowledge mutation now fires `scheduleTenantAudit`
immediately after `invalidateTenantKnowledge`, so the saved report refreshes on its own
instead of going stale until a manual "Check again." `scheduleTenantAudit` is self-coalescing
per tenant (one audit at a time via a local `Set` + a shared `claimOnce` lock), so bulk
uploads and rapid edits cannot burst the LLM, and the content-hash staleness check remains as
a backstop.

---

## 3. Prioritized Engineering Roadmap for "Perfect Working"

A prioritized plan to reach optimal data integrity and complete the feedback loops —
**without breaking the single-phase architecture.** The two data-integrity/correctness bugs
and the Step 9 feedback loop are now **done**; what remains is UX polish and the one optional,
schema-touching telemetry feature.

### ✅ Completed (verified on `aakarsh/improvement`, all suites green)

**Step 6 G1 — Sandbox Isolation** *(was highest severity)*
`sandbox` is threaded through `runTenantChat` into the engine `ctx`. When true, the turn uses
a synthetic unpersisted session and skips every write — `chatSession`/`chatMessage`,
`recordTurn`, `trackLeadActivity`, team alerts — and `engine/ticketing.js` returns `null`
before filing a ticket. Dashboard tests no longer pollute telemetry or raise phantom tickets
(this also cleaned up Step 8). Test: `sandboxIsolation.test.js`.

**Step 2 G1 — Slug ↔ Email `P2002` Disambiguation**
`violatedTargets(e)` inspects `error.meta.target`; a slug-only clash re-rolls the suffix and
retries (`MAX_SLUG_RETRIES = 3`, 503 only on exhaustion), while `signupEmail` (or an unknown
index) returns `ACCOUNT_EXISTS`. Test: `registerSlugConflict.test.js`.

**Step 9 G2 — Automatic Readiness Re-check** *(no migration)*
Every document mutation (`POST /documents`, `/documents/file`, `/documents/pdf`,
`PATCH`/`DELETE /documents/:id`, `/scrape`) fires `scheduleTenantAudit` after
`invalidateTenantKnowledge`. The scheduler is self-coalescing per tenant (a local `Set` +
shared `claimOnce` lock), so bulk/rapid changes can't burst the LLM; content-hash staleness
remains the backstop. Test: `readinessRoutes.test.js` (updated to assert auto-refresh).

**Step 9 G1 — The "Add the Answer" Loop** *(no migration)*
`POST /tickets/:id/answer` creates the knowledge document and marks the ticket `answered` in
one `prisma.$transaction`; after commit it clears the RAG cache and schedules a re-audit.
Tenant-scoped, defaults to the `FAQ` category, enforces `roomForDocuments`, and refuses an
already-answered ticket. `TicketsList.js` adds a per-open-ticket "Add the answer" inline form
wired to `ws.answerTicket`. Test: `ticketAnswer.test.js`.

**Step 3 G1 — "Check Your Categories" Advisory** *(no migration)*
`KnowledgeUploadStep.js` shows a dismissible amber advisory in the "Your knowledge" card when
there is more than one entry and all share a single category, naming the missing categories to
add. Pure client-side; advice, never a gate.

**Step 5 G1 — Post-Completion Redirect** *(no migration)*
Finalize now redirects to `/dashboard/bots`. The show-once API key + embed snippets were
extracted into a shared `SignupWelcome` component rendered on the bots page (and `/dashboard`
as a fallback); it consumes the one-time sessionStorage handoff on first load, so the key
still surfaces exactly once. Verified with `next build`.

### 🔭 Remaining

**Step 7 G1 + G2 — Widget Telemetry** *(Low, optional, **requires schema change**)*
Add `widgetSeenAt` (and optionally `widgetUrl`) to `TenantApiKey`. Expose a lightweight
`POST /ping` the widget calls on load, and a dashboard `install-status` poll (~30s) that flips
the UI to "widget detected." The one item that touches the schema and leans toward the spec's
lifecycle model.

---

### Appendix: Finding Index (by severity)

| # | Finding | Severity | Schema change? | Status |
|---|---|---|---|---|
| 1 | **Step 6 G1** — sandbox not isolated (writes sessions/messages, can file tickets) | 🔴 High (data integrity) | No | ✅ Resolved |
| 2 | **Step 9 G1** — "Add the answer" ticket→FAQ loop missing | 🟠 Medium (feature) | No | ✅ Resolved |
| 3 | **Step 2 G1** — slug vs. email `P2002` misattribution | 🟠 Medium (correctness) | No | ✅ Resolved |
| 4 | **Step 9 G2** — no auto readiness re-check on knowledge change | 🟠 Medium (feature) | No | ✅ Resolved |
| 5 | **Step 3 G1** — "check your categories" advisory missing | 🟡 Low (UX) | No | ✅ Resolved |
| 6 | **Step 7 G1+G2** — widget ping telemetry + install-status polling | 🟢 Low (optional) | **Yes** | 🔭 Open |
| 7 | **Step 5 G1** — redirect to `/dashboard/bots` | 🟢 Low (polish) | No | ✅ Resolved |

**Everything not listed above conformed to spec** — notably all of Step 1 (OTP security),
Step 4 (scoring + dismissible requirements), Step 8 (live chat auth + rate limiting), and
the confidence-gating core of Step 9. The single-phase architecture is sound; the resolved
items complete the feedback loops, fix two real bugs and add the UX polish **on top of it**,
not against it. Only the optional, schema-touching widget telemetry (Step 7) remains.
