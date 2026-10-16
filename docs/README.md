# KGT AI Hub — Documentation

A multi-tenant SaaS platform where each customer company trains a Support bot
and a Sales bot on its own content and embeds them on its website.

## Start here

| If you are… | Read |
|---|---|
| New to the project | [PROCESS_FLOW.md](PROCESS_FLOW.md) — the whole lifecycle, signup to follow-up |
| Setting up to write code | [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) |
| Embedding a bot on a website | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| On call | [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) |
| Explaining what the product does | [SPECIFICATIONS.md](SPECIFICATIONS.md) |
| Looking up a field, env var or endpoint | [DOCUMENTATION.md](../DOCUMENTATION.md) |
| Writing or running tests | [TESTING.md](../TESTING.md) |
| Just trying to run it | [README.md](../README.md) |

## All documents

| Document | Covers | Audience |
|---|---|---|
| [README.md](../README.md) | what it is, how to run it, the security model in brief | everyone |
| [docs/PROCESS_FLOW.md](PROCESS_FLOW.md) | end-to-end process flow: the seven stages, every decision point, the data written at each step, and a code index | engineers, product, support |
| [docs/SPECIFICATIONS.md](SPECIFICATIONS.md) | product specifications and features: every capability, limit and threshold, illustrated with screenshots of the live platform | sales, prospects, engineering, QA |
| [docs/pdf/](pdf/) | both documents as branded PDFs for sharing — [Process Flow](pdf/KGT-AI-Hub-Process-Flow.pdf) and [Specifications](pdf/KGT-AI-Hub-Specifications.pdf); rebuild with [docs/pdf/build](pdf/build/) after editing the markdown | anyone outside the repo |
| [docs/DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | local setup, repository map, conventions, how to make common changes, debugging | engineers |
| [docs/INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | the embed widget, the chat API, sessions, key rotation, CSP, go-live checklist | developers at customer companies |
| [docs/OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | routine checks, incident procedures, tenant lifecycle, backup/restore, scaling limits | whoever runs the deployment |
| [DOCUMENTATION.md](../DOCUMENTATION.md) | the reference: architecture, schema, security, every env var, full API tables | engineers, ops |
| [TESTING.md](../TESTING.md) | the four test layers and the release gate | engineers |

## The shape of the system in one minute

- **Two bots, one knowledge base.** Each company's documents are split into
  sections; every section is scoped to the Support bot, the Sales bot, or both.
  The two bots are specialists over one shared set of content, with different
  personas and different ranking weights.
- **Grounded or handed off, never guessed.** Retrieval is lexical and produces a
  confidence score. Below the tenant's threshold (0.30 by default) the bot does
  not answer — it offers a follow-up and files a ticket.
- **One engine, no code per industry.** `engine/` knows nothing about any
  business; `domains/tenantProfile.js` builds both profiles from the tenant's own
  database row. A new vertical is a new row, not new code.
- **Isolation is structural.** Every per-tenant query reads the tenant from the
  session and scopes each lookup by its id, so another company's data reads
  exactly like data that does not exist.
- **Degrades instead of failing.** Every LLM provider down means a polite "try
  again" reply plus a ticket, not an error page.

## Keeping these current

| When you change… | Update |
|---|---|
| A route or its contract | Appendix A of DOCUMENTATION.md; the stage in PROCESS_FLOW.md |
| The schema | DOCUMENTATION.md §4; the data lifecycle map in PROCESS_FLOW.md |
| An environment variable | DOCUMENTATION.md §6.2; the production checklist in DEVELOPER_GUIDE.md |
| A threshold, weight or limit | the table that quotes the number — PROCESS_FLOW.md §4, §5, §7, §10 |
| The widget's attributes | INTEGRATION_GUIDE.md §1 |
| An operational procedure | OPERATIONS_RUNBOOK.md |

Numbers in these documents are quoted from the code with the owning file named
next to them. When a constant changes, grep the docs for the old value.
