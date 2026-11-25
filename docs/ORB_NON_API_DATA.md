# Orb UI — data NOT provided by any API

This note records the pieces of information shown on the new **Orb** web pages
(`apps/web/pages/*`, `apps/web/components/orb/*`) that **no backend API returns**.
These are fixed product/engine behaviour or display constants, so they are kept
as frontend constants (or static text) rather than being fetched. Anyone wiring
an Orb card to real data should leave these as-is and only bind the fields that
an API actually provides.

> Scope: frontend only. We are not changing the backend, so where the API does
> not expose something, the note below is the intended source instead.

---

## 1. Sources card — "category note"  (NOT from any API)

- **Where:** the grey note box at the **bottom of the "Knowledge Orb can use"
  card** (`components/orb/testorb/SourcesCard.js`, `note` prop; passed from
  `pages/testorb/index.js`).
- **What it says:** how Orb prioritises each knowledge category, e.g.
  *"FAQ is read first for patient questions. Policies & pricing is trusted for
  money questions. Overview says what you do."*
- **Why there is no API:** this is fixed engine behaviour, identical for every
  tenant — it is not tenant data, so no endpoint returns it.
- **Intended source:** the shared frontend constant
  `lib/documentCategories.js` → `DOC_CATEGORIES[].hint` (one hint per category),
  or the short hand-written version already on the card. Do **not** try to fetch
  it.

## 2. Sources card — row "sub-line" descriptor  (PARTIAL / not from API)

- **Where:** the second line under each source title in the Sources card
  (mock shows "PDF, 2 pages", "11 pages", "Written entry").
- **What the API gives:** `ws.listDocuments()` returns
  `id, title, content, category, botScope, sourceUrl, createdAt, updatedAt`.
- **Not available from the API:** the original **file type / page count**
  ("PDF, 2 pages") and the **website page grouping** ("11 pages" under one site —
  each crawled page is its own document, so there is no rollup).
- **Intended source:** derive from `sourceUrl` — show the URL when present, else
  "Written entry". (Same limitation the Knowledge page table already has:
  `pages/knowledge/index.js` `toRow` uses `d.sourceUrl || 'Written entry'`.)

## 3. Knowledge readiness card — display constants  (NOT from API)

In both `components/orb/knowledge/KnowledgeReadinessCard.js` and
`components/orb/testorb/KnowledgeReadinessPanel.js`:

- **`max` (100)** — the gauge/score denominator. Fixed, not returned by
  `ws.getReadiness()`.
- **"Ready 80" marker** — the 80% threshold line. Fixed product constant.
- **"What to add to reach Ready (80%)" title** — static label. (The list items
  under it *are* from the API: `report.bots[bot].requirements`, falling back to
  `criticalGaps`.)
- **"Add knowledge" action (`onAdd`)** — navigation only (to `/knowledge`); no
  API involved.

## 4. Status pill tone — derived, not returned

- **Where:** the Ready / Moderate / Not ready pill on the readiness cards.
- **Note:** the API returns a numeric `score` (and sometimes `level`); the
  **tone** (tint vs yellow) is derived on the frontend from the score bands
  (>= 80 ready/tint, else needs-attention/yellow). No tone field exists in the API.

## 5. Conversations page (Real mode) — fields with no backing data  (NOT from API)

The Orb **Conversations** page (`pages/conversations/index.js`,
`components/orb/conversations/*`) has a **Dummy / Real** toggle. In **Real** mode
the list + detail are wired to the **Sessions** API (`ws.listSessions` →
`GET /sessions`, and `ws.getSession` → `GET /sessions/:id`). The following parts
of the Orb mock design have **no equivalent in that API**, so they stay
**Dummy-only** and are omitted (or simplified) in Real mode:

- **Per-message `source`** (e.g. *"From Fees and packages · Policies & pricing"*
  under an Orb answer) — `GET /sessions/:id` messages return
  `id, role, content, confidence, answered, createdAt` only; there is **no
  per-message document source**.
- **Per-message annotation boxes** (the Ticket / Action / Lead chips under an Orb
  reply, `ConversationDetail` `boxes`) — not returned by the API.
- **"Correct this answer"** action (`correct` flag + `onCorrect`) — there is **no
  session-message correction endpoint**; sessions are read-only.
- **Booked / Ticket / Person pills** — only **lead status** is available
  (`leads[].status` → *Lead · New/Contacted*); the other pill types have no data.
- **Meta extras** — the mock meta carries **language, page path and chat cost**
  (*"Hinglish · /ivf-cost · cost ₹5.10"*); the API gives only
  `botType, messageCount, startedAt, lastMessageAt, endedAt`, so Real meta is
  e.g. *"Tue 3 Nov, 10:42 pm · 4 messages · Support bot"*.
- **Date-range + Branch selects**, and the **filter tabs** (All / After hours /
  Left details / Became a ticket / Asked for a person) — **no API** backs these;
  `GET /sessions` supports only a **bot filter** (`botType=all|sales|support`)
  and cursor paging. They are hidden/inert in Real mode (full tab wiring is a
  later task).

- **List `text` preview** — the mock shows the visitor's opening line;
  `GET /sessions` returns **no messages**, only `summary`, so Real mode shows the
  summary's **intent line** (or "Summary being written…" when
  `summaryStatus` is pending).

> **Implementation note (React Query):** Real mode uses **React Query**
> (`@tanstack/react-query`, already in the app) for the optimized version —
> `useQuery(['orb-sessions', botType])` for the list (cursor paging via the
> `nextCursor` the API returns) and `useQuery(['orb-session', id])` for the
> selected conversation. This gives caching, dedupe and background refetch (e.g.
> polling while `summaryStatus === 'pending'`), matching how the existing
> Leads & Summaries Sessions tab behaves.

---

## Quick reference

| UI element | Page / component | Source |
| --- | --- | --- |
| Sources card **category note** | `testorb` · `SourcesCard` | Static / `DOC_CATEGORIES[].hint` — **no API** |
| Sources row **sub-line** ("PDF, 2 pages" / "11 pages") | `testorb` · `SourcesCard` | Derive from `sourceUrl` — **not in API** |
| Readiness **max (100)** | knowledge/testorb readiness | Fixed constant — **no API** |
| Readiness **"Ready 80" marker** | knowledge/testorb readiness | Fixed constant — **no API** |
| Readiness **"what to add" title** | knowledge/testorb readiness | Static label — **no API** (list items from `getReadiness`) |
| Readiness **Add knowledge** action | knowledge/testorb readiness | Navigation — **no API** |
| Status pill **tone** | readiness cards | Derived from score — **not in API** |
| Conversation **per-message source** | `conversations` · `ConversationDetail` | **No API** (messages have no source) |
| Conversation **annotation boxes** (Ticket/Action/Lead) | `conversations` · `ConversationDetail` | **No API** |
| Conversation **"Correct this answer"** | `conversations` · `ConversationDetail` | **No API** (sessions read-only) |
| Conversation **Booked/Ticket/Person pills** | `conversations` list + detail | Only lead status — **not in API** |
| Conversation **meta** (language / path / cost) | `conversations` list + detail | **Not in API** (botType/messageCount/dates only) |
| Conversation **date-range / branch / tabs** | `conversations` page | **No API** (only `botType` + cursor) |
| Conversation list **text preview** | `conversations` · `ConversationList` | Summary intent line — **no messages in list API** |
