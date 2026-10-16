# Integration Guide

For developers putting a KGT AI Hub bot on a website or into an application.

You need two values, both from your dashboard at `/dashboard/keys`:

| Value | Looks like | Where |
|---|---|---|
| Tenant slug | `acme-a1b2c3` | shown on the dashboard; `data-tenant-id` in the snippet |
| API key | `tk_` + 48 hex characters | shown **once** when issued — store it, you cannot read it back |

---

## 1. The quickest route: the embed widget

One script tag, anywhere before `</body>`:

```html
<script src="https://YOUR-API-HOST/widgets/tenant-chat-widget.js"
        data-tenant-id="acme-a1b2c3"
        data-api-key="tk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        data-bot="support" defer></script>
```

The widget renders its own launcher button and panel, calls the API directly
with `fetch()`, and keeps the conversation going across messages. No iframe, no
build step, no CSS to include.

### Attributes

| Attribute | Required | Default | Notes |
|---|---|---|---|
| `data-tenant-id` | yes | — | your slug, not a numeric id |
| `data-api-key` | yes | — | sent as `X-Tenant-Api-Key` |
| `data-bot` | no | both, with a toggle | `support` or `sales`; locks the widget to one bot |
| `data-default-bot` | no | `support` | which bot opens first when `data-bot` is omitted |
| `data-api-base` | no | the script's own origin | override if the API is served from another host |

An unrecognised `data-bot` value falls back to `support` with a console warning.

### Which bot on which page

| Page | Bot | Why |
|---|---|---|
| Landing, pricing, product, campaign pages | `sales` | the visitor is evaluating; this bot leads with positioning, pricing and proof |
| Customer portal, dashboard, help centre, post-purchase | `support` | the visitor already bought; this bot leads with how-to steps, FAQs and policies |
| A page serving both | omit `data-bot` | one widget with a Support/Sales toggle |

Both bots read the same documents — the difference is which sections each one is
allowed to use, plus its persona and ranking weights. Set it per page rather
than trying to pick one bot for the whole site.

### The API key is public by design

A `tk_` key in a page's HTML is visible to anyone who views source. That is
expected: the key authorises **chat for your tenant only** and nothing else. It
cannot read your documents, your leads, your tickets or your usage. The cost
exposure is bounded by the per-tenant chat rate limit.

Rotate it like any other credential if it shows up somewhere it shouldn't — see
[§5](#5-rotating-a-key-without-downtime).

---

## 2. Calling the chat API directly

Use this when you want your own UI, a mobile app, or a server-side integration.

```
POST https://YOUR-API-HOST/api/v1/tenant-chat/{slug}/chat
X-Tenant-Api-Key: tk_...
Content-Type: application/json
```

### Request

```json
{
  "query": "How do I reset my password?",
  "botType": "support",
  "sessionId": "e0e1…",
  "externalUserId": "customer-4821"
}
```

| Field | Required | Notes |
|---|---|---|
| `query` | yes | 1–1000 characters |
| `botType` | no | `support` (default) or `sales`. Alias: `bot`. An unknown value is a 400, not a silent fallback |
| `sessionId` | no | omit on the first message; pass the returned value back to continue the conversation |
| `externalUserId` | no | your own user identifier, ≤ 200 chars — opaque to us, stored on the session so you can correlate later |

### Response

```json
{
  "answer": "To reset your password:\n• Open Settings → Security\n• …",
  "followUps": ["How do I change my email?", "Can I talk to someone on your team?"],
  "sessionId": "e0e1…",
  "botType": "support",
  "bot": "support",
  "sourceSection": "Account help — Passwords",
  "handoff": false,
  "awaitingContact": false
}
```

| Field | Meaning |
|---|---|
| `answer` | plain text with `•` bullets — already normalised, no markdown to render |
| `followUps` | 0–3 suggested next questions; render as clickable chips. Empty while the bot is waiting for an email |
| `sessionId` | **store and send back** — without it every message starts a new conversation with no history |
| `handoff` | the bot could not answer and a ticket was filed for your team |
| `awaitingContact` | the reply asked for an email address; the next message is expected to be one |
| `sourceSection` | Support bot: the heading of the section the answer was grounded in. `null` on a handoff |
| `keyBenefitsHighlighted` | Sales bot: benefit tags from the cited excerpts, for badges if your UI wants them |
| `bot` | which persona answered — same value as `botType` |
| `cached` | present when the answer was served from cache rather than a fresh model call |
| `degraded` | present when every model provider was unavailable |

The confidence score behind an answer is deliberately **not** returned. It is
stored on the message and visible to you in the dashboard.

### curl

```bash
curl -s -X POST https://YOUR-API-HOST/api/v1/tenant-chat/acme-a1b2c3/chat \
  -H "X-Tenant-Api-Key: tk_..." \
  -H 'Content-Type: application/json' \
  -d '{"query":"What are your support hours?","botType":"support"}'
```

### Minimal client

```js
let sessionId = null;

async function ask(query, botType = 'support') {
  const res = await fetch(`${API_BASE}/api/v1/tenant-chat/${SLUG}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Api-Key': API_KEY },
    body: JSON.stringify({ query, botType, sessionId })
  });

  if (res.status === 429) return { answer: 'One moment — too many messages just now. Try again shortly.' };
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);

  const data = await res.json();
  sessionId = data.sessionId;   // carry the conversation forward
  return data;
}
```

### Status codes

| Code | Meaning | What to do |
|---|---|---|
| 200 | answered — including a handoff reply | render `answer` |
| 400 | empty/too-long `query`, or an unknown `botType` | fix the request |
| 401 | missing, wrong, revoked, or another tenant's key | check the key |
| 404 | unknown slug, or the account is deactivated | check the slug; contact us |
| 429 | per-tenant chat limit (30 per 10 min by default) | back off; show a friendly wait message |
| 500 | unexpected server error | retry once, then report it |

An LLM outage is **not** an error status: you get a 200 with a polite "try again
in a few minutes" answer, and the question is filed as a ticket so it reaches a
person. Your UI needs no special case for it.

---

## 3. Conversation and session handling

- **One `sessionId` per conversation.** The engine loads the last 6 turns for
  context, which is what makes "yes, please do" or a bare email address work as
  a reply to the bot's previous question.
- A `sessionId` belonging to another tenant simply is not found and a new
  session starts — no error, no leak.
- There is no "end conversation" call. Drop the `sessionId` and the next message
  starts fresh; lead summaries settle 120 seconds after the last message.
- Keep the session for the life of the page or the chat panel. Persisting it in
  `sessionStorage` is reasonable; persisting it forever is not — a conversation
  from last month resuming mid-thread reads oddly.

---

## 4. Lead capture

You do not implement this. When a visitor leaves an email in the chat:

1. the bot attaches it to that conversation and confirms;
2. the visitor gets a confirmation email recapping the bot's answers;
3. a `Lead` appears in your dashboard with an AI summary of the conversation,
   marked `NEW` until someone on your team marks it `CONTACTED`.

`awaitingContact: true` is your cue that the reply asked for an email — a good
moment to show an email input instead of the normal message box, if your UI
wants to help.

---

## 5. Rotating a key without downtime

```
1. Dashboard → Keys → Issue new key, label it ("site 2026-10")
2. Update the embed / your config with the new key
3. Send one test message and confirm it answers
4. Dashboard → Keys → Revoke the old key
```

Keys are stored as SHA-256 hashes only, so a lost key is rotated, never
recovered. Revoking your **last** live key takes your widget offline, so the API
requires an explicit confirmation for that one.

---

## 6. Content Security Policy

If your site sends a CSP, allow the script and the API origin:

```
script-src  'self' https://YOUR-API-HOST;
connect-src 'self' https://YOUR-API-HOST;
```

The widget injects its own styles, so a strict `style-src` also needs
`'unsafe-inline'` — or serve your own UI against the API
([§2](#2-calling-the-chat-api-directly)) instead.

---

## 7. Before you go live

- [ ] Readiness audit is at least **Moderate** for every bot you deploy
- [ ] The Test bots sandbox answers your ten most common real questions
- [ ] "Knowledge split" shows sections on both sides, if you deploy both bots
- [ ] `data-bot` matches the page: `sales` public, `support` behind a login
- [ ] A deliberately unanswerable question produces a handoff, and the ticket
      appears in your dashboard
- [ ] An email typed into the chat produces a lead and a confirmation email
- [ ] The key in the page is the one you intend to keep; older keys are revoked
- [ ] Someone owns the Tickets and Leads pages day to day

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No launcher appears | script blocked by CSP, or `data-tenant-id`/`data-api-key` missing | check the browser console — the widget logs both cases |
| Every message returns 401 | key revoked, mistyped, or from another tenant | issue a fresh key |
| 404 on every call | wrong slug, or the account is deactivated | confirm the slug on the dashboard |
| The bot hands off questions it should answer | the content is missing, or scoped to the other bot | Test bots → Knowledge split; set the document's "Used by" to `BOTH`; re-run the readiness audit |
| Answers are vaguely right but miss the specifics | the detail is in a marketing page, not a policy or price document | add it as `CUSTOM_POLICY` — both bots weight policy content up for money and rules questions |
| Replies are "try again in a few minutes" | the platform's LLM providers are unavailable | tickets are still being filed; contact us |
| The conversation forgets context | `sessionId` not being sent back | store the value from each response and include it in the next request |
