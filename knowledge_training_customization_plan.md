# Knowledge Training Customization — Technical Implementation Plan

**Scope:** Four interactive features for the KGT AI Hub onboarding wizard and the
dashboard training panel:

1. Clickable / inspectable knowledge-base items
2. Contextual "Why this matters" explanations for every gap
3. Opt-out ("Not applicable / Optional") toggle per requirement
4. Dynamic training-score recalculation that excludes dismissed requirements

> **Status (2026-11-18):** All four features are **implemented** on branch
> `aakarsh/improvement` (API suite 734/734 green). This document is therefore both
> the implementation plan and the as-built reference: every file path, function
> signature, data model and API contract below reflects the code on that branch.
> Where this plan's field names differ from the prompt's requested names, a mapping
> table is given (§3).

---

## 0. Architecture context: how training scoring actually works

The readiness score is **not** a simple `satisfied / total` requirement ratio. It is
a **pillar-weighted** model in `apps/api/src/services/botAuditor.js`:

- Five shared **pillars** (`PILLARS`): `identity`, `features`, `pricing`, `support`,
  `sales`. An LLM scores each 0–100 from a digest of the tenant's content (keyword
  heuristic fallback when no model is configured).
- Each **bot** has its own pillar weights (`BOT_WEIGHTS`, each row sums to 100):
  - `support`: identity 15, features 20, pricing 5, support 60, sales 0
  - `sales`: identity 15, features 25, pricing 30, support 0, sales 30
- Per bot: `weighted = round(Σ(pillarScore × weight) / Σweight)` over in-scope
  pillars, then `score = min(weighted, contentCap)` where `contentCap` (`capFor`)
  limits a bot that simply lacks enough usable text.
- Overall `readinessScore = min(score)` across deployed bots; `levelFor(score)` maps
  to Not Ready (<50) / Moderate (50–79) / Production Ready (≥80).

**Consequence for Feature 4:** "remove a dismissed requirement from the denominator"
is faithfully realized as *drop the dismissed gap's pillar from the weighted
average and renormalize over the remaining pillar weights* (§5). Requirement/gap
items are therefore **keyed to pillars** (`key = "<bot>:<pillar>"`).

Key reusable primitives already in `botAuditor.js`:

| Symbol | Purpose |
|---|---|
| `PILLARS`, `PILLAR_IDS` | the five pillars + ids |
| `BOT_WEIGHTS` | per-bot pillar weights |
| `MODERATE_AT = 50`, `READY_AT = 80` | level thresholds |
| `capFor(characters)` → number | content-length cap |
| `levelFor(score)` → string | band label |
| `CATEGORY_REQUIREMENTS`, `categoryRequirement(category, pillar)` | category-tailored "add this" text |
| `normalizeCategory(value)` | validates `businessCategory` → key or `null` |

---

## 1. Feature 1 — Clickable / inspectable knowledge-base items

### Decision
Reuse and polish the **in-place accordion** that already exists, rather than add a
separate modal. The wizard's knowledge list (`EntryRow`) already expands to reveal
the parsed title, source, category, bot-scope and the **full parsed content**
(editable). This already satisfies "verify what was captured"; a modal would
duplicate it. (A modal/drawer remains a viable alternative — see §10.)

### Files
- `apps/web/components/signup/KnowledgeUploadStep.js` — `EntryRow` component.

### UI state & flow
- `EntryRow` holds `const [open, setOpen] = useState(!!page.autoExpand)`.
- Collapsed row: icon (`IconGlobe` for URL, `IconDocs` for file, `IconPencil` for
  written), title, truncated source, category label, chevron.
- Expanded body (added): a read-only **metadata line** —
  `category · source · N characters` — where a scraped `page.url` renders as a
  **clickable link** (`<a target="_blank" rel="noopener noreferrer">`), followed by
  the existing editable title / content / category / bot-scope controls.

### Data payload (already available; no new fetch)
Each page object in wizard state carries everything the inspector needs — no extra
API call is required:

```ts
type WizardPage = {
  id: string;
  title: string;
  content: string;      // full parsed markdown (the "snippet" is content.slice)
  url?: string;         // source URL for crawled pages (clickable)
  sourceFile?: string;  // filename for uploads
  category: string;     // DOC_CATEGORIES id → categoryLabel(category)
  botScope?: string;    // BOT_SCOPES id
  deleted?: boolean;
};
```

Source of this data: `POST /api/v1/public/register/analyze` (crawl) and
`/analyze-file` (uploads) already return `{ title, content, url, category }` per page.

### Dashboard parity
The dashboard document list (Documents page) already links each `TenantDocument` to
its editor; no change required for Feature 1 there. Character count = `content.length`.

### Tasks
1. In `EntryRow`'s expanded block, prepend the metadata line (category · source ·
   chars); render `page.url` as an anchor, else plain `sourceFile`/"Written by you".
2. Keep all existing edit controls untouched.

---

## 2. Feature 2 — Contextual "Why this matters" explanations

### Data model (as-built)
Each bot in the audit report gains `requirementItems`, one entry per **in-scope
pillar scoring below `MODERATE_AT`** (the genuine gaps):

```ts
type RequirementItem = {
  key: string;          // "support:pricing" — stable, addressable for dismissalin
  pillar: string;       // pillar id
  label: string;        // human pillar label, e.g. "Pricing, Packaging & Licensing"
  text: string;         // the category-tailored ask (categoryRequirement)
  description: string;  // what the information IS
  importance: string;   // why it's critical — category-specific where it differs
  botUtility: string;   // how the bot uses it to answer without guessing
  pillarScore: number;  // current 0–100 pillar score (impact signal)
};
```

### Requested-schema mapping
| Prompt field | As-built field | Notes |
|---|---|---|
| `title` | `label` (+ `text`) | pillar label is the heading; `text` is the concrete ask |
| `importanceDescription` | `importance` | category-aware via `importanceFor` |
| `categoryRelevance` | encoded **inside** `importance` | `importanceFor(category, pillar)` selects category-specific copy |
| `impactScore` | `pillarScore` + pillar `weight` | lower `pillarScore` × higher `weight` = bigger score uplift when fixed |

> If an exact field-name match is preferred, add aliases in `botReadiness`
> (`title: label`, `importanceDescription: importance`,
> `categoryRelevance: normalizeCategory(category)`,
> `impactScore: weight`) — one-line additions, no logic change.

### Copy catalog — `botAuditor.js`
`PILLAR_INFO[pillar] = { description, botUtility, importance: { default, <category>… } }`
plus `importanceFor(category, pillar)` which returns the category override or
`default`. Example (`support` pillar):

```js
support: {
  description: 'How-to steps, setup, common problems and fixes, account help, hours and contact, SLAs, returns, refunds and warranty.',
  botUtility: 'Lets the Support Bot actually resolve existing-customer issues instead of escalating every question to a human.',
  importance: {
    default:   'Without support material the bot hands off routine questions, defeating the point of a support assistant.',
    ecommerce: 'Returns, refunds, order tracking and ingredient or allergen questions are the bulk of retail support — the bot needs them to deflect tickets.',
    healthcare:'Appointment, hours and policy questions are most of patient contact; the bot needs them to help without giving medical advice.'
  }
}
```

### Function signature change
```js
// apps/api/src/services/botAuditor.js
function botReadiness(bot, { pillarData, chunks, preference, model, hasDocs, category = null }) { … }
// returns { score, level, sections, characters, cap, pillars, criticalGaps, requirements, requirementItems }
```
Legacy `requirements: string[]` and `criticalGaps: string[]` are **kept unchanged**
for back-compat with saved reports and existing tests.

### UI rendering
- Wizard `TrainingReadinessStep.js` → `RequirementItem` component: shows `text`, a
  **"Why this matters"** disclosure (reusing `IconChevronDown`) that expands a
  3-cell `<dl>` of `description` / `importance` / `botUtility`.
- Dashboard `BotReadinessPanel.js` → `GapItem` component: same disclosure, inside
  the per-bot "Add to fully train it" section (`PerBotReport`).
- Both fall back to the legacy string list when a report has no `requirementItems`.

---

## 3. Feature 3 — Opt-out toggle ("Not applicable / Optional")

### Storage decision
- **Onboarding (wizard):** dismissals live in React **session state** (a `Set` of
  `requirementItem.key`), persisted to the tenant at launch.
- **Dashboard:** dismissals are stored **inside the existing `Tenant.readinessReport`
  JSON** as `report.ignoredRequirements: string[]` — **no Prisma schema change**.
  (Trade-off: a fresh AI re-audit resets them; see §10.)

### Data model
```ts
// Added to the report object (both wizard payload and saved readinessReport)
type ReadinessReport = {
  …
  ignoredRequirements?: string[]; // requirementItem keys dismissed by the user
};
```

### State management
**Wizard — `apps/web/pages/register.js`:**
```js
const [ignored, setIgnored] = useState(() => new Set());
const toggleIgnored = (key) => setIgnored((prev) => {
  const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next;
});
// Prune keys that no longer match a gap (e.g. an upload resolved that pillar):
const itemKeys = new Set(Object.values(audit.report?.bots||{}).flatMap(b => (b.requirementItems||[]).map(i => i.key)));
const effectiveIgnored = new Set([...ignored].filter(k => itemKeys.has(k)));
const displayReport = audit.report ? applyIgnoredRequirements(audit.report, effectiveIgnored) : null;
```
`effectiveIgnored` is passed to `TrainingReadinessStep` and sent to `/complete`.

**Dashboard — `apps/web/components/workspace/TrainingCheckDrawer.js`
(`WorkspaceTrainingCheck`):**
```js
const toggleIgnored = async (key) => {
  const set = new Set(state.report?.ignoredRequirements || []);
  set.has(key) ? set.delete(key) : set.add(key);
  setState((s) => ({ ...s, report: applyIgnoredRequirements(s.report, set) })); // optimistic, instant
  const report = await ws.setIgnoredRequirements([...set]);                     // persist + reconcile
  setState((s) => ({ ...s, report }));
};
```

### UI
- Wizard `RequirementItem`: an **"Not applicable"** button; dismissed items move to a
  collapsed **"Dismissed as not applicable (N)"** group, each with **Undo**.
- Dashboard `GapItem`: identical "Not applicable" / "Undo" affordance, gated on an
  `onToggleIgnored` prop so the panel stays presentational when dismissal is disabled.

### API contracts
**Persist at signup — `POST /api/v1/public/register/complete`** (extended):
```jsonc
// request body (addition)
{ "...": "...", "ignoredRequirements": ["sales:sales", "support:pricing"] }
```
Server sanitizes (`parseIgnoredRequirements`: array of ≤100-char strings, deduped,
capped at 50) and, after obtaining the reviewed report, applies
`recomputeReadiness(report, ignoredRequirements)` before `saveTenantReadiness`.

**Persist on dashboard — `PATCH /api/v1/client/workspace/readiness/ignored`** (new):
```jsonc
// request
{ "ignoredRequirements": ["sales:sales"] }
// 200 response: the recomputed, saved report (same shape as GET /readiness .report)
{ "readinessScore": 80, "readinessLevel": "Production Ready",
  "bots": { "sales": { "score": 80, "level": "Production Ready", "requirementItems": [ … ] } },
  "ignoredRequirements": ["sales:sales"], "...": "..." }
// 409 if no saved report exists yet
{ "error": "Run a training check first — there is no report to adjust yet." }
```
Registered in `apps/api/src/routes/tenantWorkspace.routes.js`; no LLM call, so no
extra rate-limit beyond the existing client auth. Client method:
`ws.setIgnoredRequirements(keys)` in `apps/web/lib/api.js`.

---

## 4. Feature 4 — Dynamic training-score recalculation

### Formula
Expressed in the prompt's requested form, over the **kept** (non-dismissed) in-scope
pillars of a bot:

```
earned_points        = Σ ( pillarScore_i / 100 × weight_i )     for kept pillars i
adjusted_max_points  = Σ ( weight_i )                           for kept pillars i
weighted             = (earned_points / adjusted_max_points) × 100
score                = min( round(weighted), contentCap )
```

This is algebraically identical to the implemented
`round(Σ(score_i × weight_i) / Σ(weight_i))`. Dismissing a **below-average** pillar
(all dismissible gaps are `< MODERATE_AT`, so they drag the average down) strictly
**raises** the score. The content cap is deliberately **not** relaxed — a tenant
cannot dismiss past "too little usable content."

### Canonical implementation — `botAuditor.js`
```js
/** Pure, LLM-free. Does not mutate `report`. */
function recomputeReadiness(report, ignoredKeys = []) {
  const ignored = new Set(ignoredKeys);
  const next = JSON.parse(JSON.stringify(report));
  for (const [bot, data] of Object.entries(next.bots)) {
    const kept = (data.pillars || []).filter((p) => !ignored.has(`${bot}:${p.id}`));
    const wsum = kept.reduce((n, p) => n + p.weight, 0);
    const weighted = wsum ? Math.round(kept.reduce((n, p) => n + p.score * p.weight, 0) / wsum) : data.score;
    data.score = Math.min(weighted, Number.isFinite(data.cap) ? data.cap : 100);
    data.level = levelFor(data.score);
  }
  const scores = Object.values(next.bots).map((b) => b.score);
  if (scores.length) { next.readinessScore = Math.min(...scores); next.readinessLevel = levelFor(next.readinessScore); }
  next.ignoredRequirements = [...ignored];
  return next;              // requirementItems kept intact → UI can show "Undo"
}
```
Requires each bot in the report to carry `cap` (added in `botReadiness`) so the
cap can be re-applied without re-crawling. Exported from `botAuditor.js`.

### Client mirror (instant, offline) — `apps/web/lib/readiness.js` (new)
`applyIgnoredRequirements(report, ignored)` + `levelFor` run the identical formula in
the browser so the % updates the moment a user toggles, with no round-trip; the
server runs the same math when persisting, so the numbers reconcile exactly.

---

## 5. Data model summary

| Where | Field | Type | Notes |
|---|---|---|---|
| audit report → `bots[bot]` | `cap` | number | content-length ceiling, enables recompute |
| audit report → `bots[bot]` | `requirementItems` | `RequirementItem[]` | §2 |
| audit report (root) | `ignoredRequirements` | `string[]` | dismissed keys |
| `Tenant.readinessReport` (Prisma `Json`) | — | — | stores the whole report incl. the two fields above; **no migration** |

No database schema change. No new tables or columns.

---

## 6. API contract summary

| Method & path | File | Change |
|---|---|---|
| `POST /api/v1/public/register/preflight-audit` | `publicRegister.routes.js` | company now carries `businessCategory`; response bots carry `requirementItems` + `cap` |
| `POST /api/v1/public/register/complete` | `publicRegister.routes.js` | accepts `ignoredRequirements`; applies `recomputeReadiness` before save |
| `GET /api/v1/client/workspace/readiness` | `tenantWorkspace.routes.js` | unchanged; returns saved (recomputed) report |
| `PATCH /api/v1/client/workspace/readiness/ignored` | `tenantWorkspace.routes.js` | **new**; recompute + persist dismissals |

---

## 7. File-by-file task list

**Backend — `apps/api/src/services/botAuditor.js`**
1. Add `PILLAR_INFO` catalog + `importanceFor(category, pillar)`.
2. In `botReadiness`: build `requirementItems` (in-scope pillars `< MODERATE_AT`),
   add `cap` and `requirementItems` to the return.
3. Add + export `recomputeReadiness(report, ignoredKeys)`.

**Backend — routes**
4. `publicRegister.routes.js`: `parseIgnoredRequirements`, parse body field, apply
   `recomputeReadiness` to the reviewed report before `saveTenantReadiness`.
5. `tenantWorkspace.routes.js`: add `PATCH /readiness/ignored` (load report →
   `recomputeReadiness` → `saveTenantReadiness` → return).

**Frontend**
6. `apps/web/lib/readiness.js` (new): `applyIgnoredRequirements`, `levelFor`,
   `READY_AT`, `MODERATE_AT`.
7. `apps/web/lib/api.js`: add `ws.setIgnoredRequirements(keys)`.
8. `apps/web/pages/register.js`: `ignored` state + `toggleIgnored`,
   `effectiveIgnored`, `displayReport`; pass to Training/Review; add to `/complete`.
9. `apps/web/components/signup/TrainingReadinessStep.js`: `RequirementItem`
   (disclosure + Upload + "Not applicable"), dismissed group with Undo; legacy
   fallback.
10. `apps/web/components/signup/KnowledgeUploadStep.js`: metadata line + clickable
    source link in `EntryRow`.
11. `apps/web/components/workspace/BotReadinessPanel.js`: `GapItem` + `onToggleIgnored`
    threaded through `PerBotReport`.
12. `apps/web/components/workspace/TrainingCheckDrawer.js`: `toggleIgnored` (optimistic
    + persist), thread `onToggleIgnored` to the panel.

---

## 8. Testing & verification

**Automated (API — `apps/web` has no test suite):**
- `apps/api/test/unit/dismissibleRequirements.test.js` (new): `requirementItems`
  present with all copy fields; category-specific `importance`; `recomputeReadiness`
  raises score on dismissing a weak pillar; cap still limits; unknown key is a
  no-op and the input is not mutated; `ignoredRequirements` set on the report.
- Back-compat: `requirements` / `criticalGaps` string shapes unchanged, so
  `botAuditor.test.js` + `categoryRequirements.test.js` stay green.
- Run: `cd apps/api && npm test` → **734 pass / 0 fail**.

**Syntax-check frontend:** SWC transform via `next/dist/build/swc` over the edited
`.js`/JSX files (no bundler needed) — all parse clean.

**Manual E2E:**
1. Wizard Training step → expand a gap → see description / importance / botUtility.
2. Click "Not applicable" → the bot % jumps **instantly** (client mirror).
3. Launch → dashboard opens at the boosted score (persisted via `/complete`).
4. Dashboard → toggle a dismiss → persists across reload (`GET /readiness`).
5. A crawl-only retail tenant that dismisses Sales-pitch/SLA gaps clears the ~33% floor.

---

## 9. Trade-offs & future work

- **No schema change** (chosen): dismissals persist in the `readinessReport` JSON.
  Consequence: a brand-new AI re-audit on the dashboard resets dismissals. A durable
  `Tenant.ignoredRequirements Json?` column (one migration) would survive re-audits —
  recommended if dismissals should be permanent policy rather than per-report.
- **Background-audit edge:** if `/complete` cannot reuse the wizard report (pages
  edited after the check), the background re-audit runs without the wizard's
  dismissals; the user re-applies them once on the dashboard.
- **Feature 1 modal alternative:** if a read-only modal/drawer is later preferred
  over the accordion, add a `KnowledgeItemModal` fed by the same `WizardPage` shape;
  no API change needed.
- **Monotonic-increase guarantee:** dismissible items are always `< MODERATE_AT`, so
  dropping one never lowers the score; if that threshold is widened later, add
  `score = max(oldScore, recomputed)` to preserve the "dismiss only rewards" UX.
