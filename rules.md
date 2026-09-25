# FLATBRIZ — Cursor rules summary

Canonical agent rules live in `.cursor/rules/*.mdc`. This file summarizes **all** of them for humans. Edit the `.mdc` files to change agent behavior; keep this summary in sync when rules change materially.

| File | Always apply? | Scope |
|---|---|---|
| `flatbriz-core.mdc` | Yes | Whole repo |
| `tenancy-rbac.mdc` | Yes | Whole repo |
| `feature-planning.mdc` | Yes | Whole repo |
| `impact-analysis.mdc` | Yes | Whole repo |
| `feasibility-risk.mdc` | Yes | Whole repo |
| `feature-checklist.mdc` | Yes | Whole repo |
| `api-conventions.mdc` | No | `apps/api/**/*.js` |
| `admin-web-conventions.mdc` | No | `apps/admin-web/**` |
| `mobile-conventions.mdc` | No | `apps/mobile/**` |
| `prisma-data.mdc` | No | `apps/api/prisma/**` |
| `auth-flows.mdc` | No | Auth routes / login / OTP / signup screens |
| `design-system.mdc` | No | Mobile + admin-web UI files |

---

## 1. Product & architecture (`flatbriz-core`)

- Product: **FLATBRIZ** — multi-tenant society / building management SaaS
- Monorepo:
  - `apps/api` — Express + Prisma
  - `apps/admin-web` — Next.js Pages
  - `apps/mobile` — Expo
- Roles: `resident`, `guard`, `building_admin`, `super_admin`
- Surfaces: mobile = resident/guard; admin-web = building admin + super admin
- Source of truth: `docs/HLAD.md`, `docs/Specifiication.md`, `apps/api/prisma/schema.prisma`
- Prefer extending existing modules over inventing parallel stacks
- Out of scope unless explicitly requested: real payment gateway, device push, marketing site
- When planning features: Impact Analysis + Feasibility/Risk before code; prefer additive, tenant-safe, backward-compatible changes

---

## 2. Tenancy & RBAC (`tenancy-rbac`)

- Tenant = `Building`; almost all domain data needs `buildingId`
- Scope requests via `X-Building-Id` / `buildingId` param; optional `X-Membership-Id` when pinning membership
- Use `authenticate` + `requireRole(...)` / `requireSuperAdmin`; never skip for domain routes
- Only **approved** memberships grant access; pending stays gated
- Super admin bypasses per-building RBAC but must not leak cross-tenant data
- Respect `BuildingFeature` flags when adding or exposing modules
- Reference: `apps/api/src/middleware/auth.js`, `apps/api/src/middleware/rbac.js`

---

## 3. Feature planning gate (`feature-planning`)

### When it applies (mandatory)

Trigger on **any** request to change product behavior or UI — including **short prompts**, e.g.:

- "add the logo on all screens"
- "fix the footer"
- "add parking slots"
- "implement X" / "build X" / "wire X"

The user does **not** need to say "do impact analysis" or "feasibility check". Those sections are **always required**. Asking for them by name only reinforces the gate.

**Exceptions (skip full gate):** typo fixes, pure renames with no behavior change, Ask-mode Q&A, or user says **just implement** / **skip planning** (still produce a **brief** impact severity + verdict before coding).

### Required sequence (before any code)

1. Clarify role(s), surface(s) (mobile / admin-web / API), Now vs Soon — ask only if blocking; else state defaults
2. Produce **Impact analysis** in the reply (even if Low)
3. Produce **Feasibility & risks** in the reply (even if Go)
4. Propose a short plan only after both
5. **Stop and wait** for user approval before editing files
6. Ask again before coding if impact is Medium/High or feasibility is Go-with-conditions / No-go

### Hard stops

- Do **not** start implementation, asset conversion, or "quick UI wiring" until the user accepts the plan
- Do **not** treat branding/UI-only work as exempt — Low impact still needs the two sections
- Do **not** skip the gate because the prompt was short or informal

---

## 4. Impact analysis (`impact-analysis`)

**Always** produce this section for feature adds — even if not requested by name; even for short/UI prompts (can be concise if Low).

Cover:

- Roles & journeys (HLAD §6.1): resident / guard / building_admin / super_admin
- Tenancy: `buildingId`, membership status, multi-membership, headers
- RBAC: new `requireRole` usage; over-broad roles; super-admin leakage
- Data model: Prisma models, migrations, backfill, cascades
- API contracts: breaking changes for mobile + admin-web
- Clients: screens, navigators, layouts, shared components
- Feature flags: need `BuildingFeature`? default on/off for existing societies?
- Side effects: notifications, email, uploads, maintenance jobs
- Cross-module links (visitors ↔ flats, bills ↔ finance, etc.)
- Out-of-scope traps: real payments or push

**Severity:** Low (additive) | Medium (schema/clients with compat) | High (auth/RBAC/tenancy or semantic changes). High requires explicit mitigation before implement.

```markdown
## Impact analysis
- Summary: Low | Medium | High
- Touched modules: ...
- Existing behaviors at risk: ...
- Breaking changes: none | list
- Required follow-ups: ...
- Safe rollout notes: ...
```

---

## 5. Feasibility & risks (`feasibility-risk`)

**Always** produce this section for feature adds — even if not requested by name. Pair with Impact analysis before any implementation.

**Feasibility checks**

- Fits Express / Prisma / Expo / Next Pages without unjustified new architecture
- Tenant-scoped with existing middleware?
- Schema exists or needs migration?
- Which clients? Depends on mock payments / no push — acceptable?
- Env/secrets needed? Seed / OTP bypass / building codes still work?

**Risk register** — every Medium/High risk needs a concrete mitigation:

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Cross-tenant leak | | | Always filter `buildingId` | |
| Pending users gaining access | | | Enforce approved membership | |
| Breaking clients | | | Additive API | |
| Migration risk | | | Expand-contract / backfill | |

**Verdict:** Go | Go with conditions | No-go / needs decision

---

## 6. Feature checklist (`feature-checklist`)

### Phase A — Plan (mandatory, including short prompts)

1. Restate feature (role, surface, journey)
2. Impact analysis complete **in the reply**
3. Feasibility & risk complete **in the reply**
4. Stop for user confirmation before code (always for Medium/High or Go-with-conditions / No-go; also for Low unless user said just implement)
5. Do not treat UI/branding-only work as exempt from steps 2–4

### Phase B — Design

6. Schema first if needed
7. API contract (additive preferred)
8. RBAC matrix: who + pending vs approved
9. Feature flag decision
10. Client touch list

### Phase C — Implement

11. Prisma migration → API (`authenticate` + `requireRole` + `buildingId`) → clients
12. Notifications/email only where existing patterns do
13. No push/real payments unless the task explicitly includes them

### Phase D — Verify

14. Regress flows called out in impact analysis
15. Happy path + negative path (wrong role, wrong building, pending membership)
16. Seed/demo accounts still behave
17. Update `docs/HLAD.md` only if tenancy/auth/boundaries change

---

## 7. API conventions (`api-conventions`) — `apps/api`

- Mount new domains in `apps/api/src/app.js` behind `authenticate`
- One route file per domain under `apps/api/src/routes/`
- Every Prisma query for tenant data must filter by `buildingId` (except true platform routes)
- Return `{ error: '...' }` JSON; match existing status codes
- Side effects: in-app `Notification` rows / email helpers — not device push
- Payments stay mock unless the task is gateway integration
- Prefer CommonJS (`require` / `module.exports`) to match the API today
- Use `requireRole(...)` / `requireSuperAdmin` from existing RBAC middleware

---

## 8. Admin web conventions (`admin-web-conventions`) — `apps/admin-web`

- Pages Router (not App Router)
- Building Admin under `pages/dashboard/[buildingId]/...`
- Super Admin for onboarding / buildings list (not post-onboard module toggle UI unless built)
- Use `AdminLayout` / `SuperAdminLayout` and `lib/api.js`
- Always pass building context on API calls
- Dense admin workflows — reuse existing UI primitives in `components/`
- Prefer CSS classes in `styles/globals.css` over new inline style objects for shell UI

---

## 9. Mobile conventions (`mobile-conventions`) — `apps/mobile`

- Resident vs Guard are separate navigators (`ResidentTabs` / `GuardTabs`)
- API client must send JWT + building context headers
- Use existing theme (`apps/mobile/src/theme`), `ScreenShell`, shared components
- Follow `design-system.md` (Emerald Fresh) — don’t invent a new palette
- Gate features on membership approval + building feature flags
- `EXPO_PUBLIC_API_URL` must use LAN IP on physical devices (not `localhost`)

---

## 10. Prisma / data (`prisma-data`) — `apps/api/prisma`

- Schema is source of truth; don’t invent fields in clients first
- New domain tables: include `buildingId` + relation to `Building`
- Use migrations; don’t hand-edit SQLite casually
- Membership = User ↔ Building ↔ Role (+ optional Flat); status `pending` | `approved`
- Money models already exist (`Bill`, `Payment`, etc.) — extend before duplicating
- Feature entitlements use `Feature` + `BuildingFeature`

---

## 11. Auth flows (`auth-flows`)

- OTP-first; password secondary (guards / super admin)
- Signup creates **pending** membership; never auto-approve residents/guards
- Dev OTP bypass (`DEV_BYPASS_AUTH` / `DEV_BYPASS_CODE`) is local-only — don’t harden product logic around it
- Building admin login: phone + OTP; Super admin: phone + password
- After verify, route by role / approved memberships / `isSuperAdmin`

---

## 12. Design system (`design-system`) — mobile + admin-web UI

- Source: `design-system.md` (Emerald Fresh)
- Primary: `#059669`; gradient: `linear-gradient(180deg, #34d39a, #059669)`
- Font: Plus Jakarta Sans; heading text `#06231a`; muted `#7ba392`
- Reuse existing buttons/cards/pills; don’t introduce a second visual language
- Status colors stay in the emerald family (warm only for pending/due)
- Brand name in product copy/docs: **FLATBRIZ** (UI may still say Society in places)

---

*Canonical behavior is defined by `.cursor/rules/*.mdc`. This file is documentation only.*
