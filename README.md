# Society Management App — Starter Codebase

A real, running starting point for the app we designed: a multi-tenant
society/building management platform with a mobile app (Expo/React Native),
an admin web app (Next.js), and a backend API (Express + Prisma) that
implements the role model and multi-tenancy from the architecture doc.

This matches the mockups you generated: colors, layout, and the screens for
Login/OTP, Resident Dashboard, Bills, Complaints, Visitor logging, Voting,
Emergency/SOS, Marketplace, Notifications, Profile, plus the Super Admin
"Onboard a new society" screen and the Building Admin dashboard.

## Structure

```
apps/
  api/           Express + Prisma backend (SQLite locally, swap to Postgres for prod)
  mobile/        Expo React Native app - Resident and Guard experiences
  admin-web/     Next.js app - Super Admin and Building Admin dashboards
```

## Prerequisites
- Node.js 18+
- npm
- For the mobile app: the free "Expo Go" app on your phone (easiest), or
  Xcode/Android Studio if you want a simulator instead

## 1. Run the backend

```bash
cd apps/api
npm install
cp .env.example .env
npx prisma migrate dev --name init
npm run seed
npm run dev
```

The API starts at `http://localhost:4000`. The seed script prints demo login
phone numbers to the console - keep it open for reference.

**Demo accounts (OTP is always `123456` in dev):**

| Role | Phone |
|---|---|
| Super Admin (Sanyam) | `+919837722599` |
| Building Admin (Green Meadows Society) | `+919876500002` |
| Resident - Asha Rao, Wing B / Flat 402 | `+919876500001` |
| Guard | `+919876500003` |

Building Code for Green Meadows Society: `GRM4821` (use this to test the
"New society? Enter your Building Code" signup flow with a fresh phone number).

## 2. Run the mobile app

```bash
cd apps/mobile
npm install
npx expo start
```

Scan the QR code with the Expo Go app on your phone. This is far lighter than
running a full emulator for day-to-day development.

**Important:** if you're testing on a physical phone, `localhost` refers to
the *phone*, not your computer. Find your computer's LAN IP (e.g.
`192.168.1.42`) and set it before starting Expo:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.42:4000 npx expo start
```

If you'd rather test in a browser tab (no phone/emulator needed) for pure UI
work, `npx expo start --web` works too, though camera/native-only features
won't be testable there.

## 3. Run the admin web app

```bash
cd apps/admin-web
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3001/login`. Log in as the Super Admin phone number
above to reach the "Onboard a new society" screen, or as the Building Admin
phone number to land on the dashboard.

## How the role model works

- Every building/society is a tenant. Nearly every table carries a
  `buildingId`.
- A user can hold multiple **memberships** (one per building + role), so the
  same phone number could be a resident in one society and a committee
  member in another.
- `X-Building-Id` header (or `?buildingId=` query param) tells the API which
  tenant a request is scoped to. Middleware (`apps/api/src/middleware/rbac.js`)
  checks the caller has an *approved* membership with an allowed role for
  that building before running the route.
- Super Admins bypass the per-building check entirely - they aren't scoped
  to one society.
- Feature entitlements live in `BuildingFeature` (building × feature × on/off).
  This is what lets the Super Admin's "Enable modules for this society" panel
  add or remove features per building without a code change.

## What's included vs. what's next

**Included and working:**
- Full Prisma schema covering every entity from the ER diagram
- OTP-based auth (mocked - logs the code to the console instead of sending
  a real SMS), building-code signup with pending-approval workflow
- RBAC middleware enforcing role + tenant scoping on every route
- All 11 backend route groups: auth, buildings (super admin + admin
  dashboard), bills, complaints, visitors, facilities, votes, announcements,
  emergency contacts, marketplace, notifications
- Full Resident mobile experience (9 screens) and Guard mobile experience
  (visitor logging, notifications, emergency directory)
- Two Super Admin / Building Admin web screens matching your mockups

**Deliberately mocked or left for a follow-up pass:**
- Payments are mocked (`payBill` just flips status to paid) - wire in
  Razorpay/Paytm/ICICI when you're ready for real transactions
- OTP delivery is mocked - swap in an SMS provider (e.g. MSG91, Twilio) in
  `auth.routes.js`
- Push notifications aren't implemented - the `Notification` table exists,
  but nothing sends a device push yet
- The admin web app only covers the two screens you mocked up (onboarding +
  dashboard). Residents list, bills management, complaints management, and
  facility/vote/announcement authoring for admins are all API-ready
  (the routes already support admin roles) but don't have web UI yet
- No automated tests yet
- PostgreSQL is required in Docker and production (`society-postgres`). Compose sets `DATABASE_URL` to Postgres; do not use SQLite on the server.

None of this was run inside the sandbox this was generated in (no display
available to test a phone screen), so please run through the steps above and
tell me what breaks - that's the fastest way to get this to "no mistakes."


Role	Phone	OTP
Super Admin (Sanyam)
+919837722599
123456

Building Admin
+919876500002
123456

Resident (Asha Rao, B-402)
+919876500001
123456

Guard
+919876500003
123456