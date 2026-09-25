## Proof-Based UPI Collections

<!-- tags: benefit:proof_based_collections, benefit:transparent_ledger -->
FLATBRIZ collects maintenance dues via UPI with automatic, proof-based reconciliation: every
payment is matched to the correct flat's bill and posted to that flat's ledger immediately, with
the UPI transaction reference stored against the entry as proof. Residents and admins both see the
same reconciled record — there's no manual "please share screenshot" step and no window for a
payment to go unrecorded. This removes the single biggest source of disputes in legacy spreadsheet
or register-based collection: "I paid, why does it still show pending?"

## Zero Payment Gateway Commission

<!-- tags: benefit:zero_gateway_commission, benefit:lower_total_cost -->
FLATBRIZ charges zero payment gateway commission on UPI maintenance collections. Many
society-management platforms route payments through a card/wallet gateway and take a percentage
cut on every transaction — on a mid-size society collecting lakhs per month, that commission adds
up to real money leaving the corpus every single month. FLATBRIZ's UPI-first collection avoids
that leakage entirely, so more of what residents pay stays with the society.

## Flexible Expense Splitting

<!-- tags: benefit:flexible_expense_splitting -->
Building admins can configure how maintenance and special expenses are split — equally per flat,
by flat area/BHK, or with separate rules for sinking fund vs. base maintenance vs. one-off
expenses (e.g. a lift repair split only among flats above the ground floor). This flexibility
means FLATBRIZ can match a society's existing bylaws and AGM-approved split logic instead of
forcing every society into one rigid formula.

## Instant PWA Installation — No App Store Needed

<!-- tags: benefit:instant_pwa_install, benefit:fast_migration -->
FLATBRIZ runs as a Progressive Web App (PWA): residents open a link and can "Add to Home Screen"
in seconds, with no app-store download, no account creation delay, and no waiting for app-store
review/approval when the team ships updates. This matters a lot during rollout — an RWA onboarding
200 flats doesn't have to chase everyone through a Play Store/App Store install funnel; a shared
link and a Building Code gets residents in immediately.

## Transparent Per-Flat Financial Ledger

<!-- tags: benefit:transparent_ledger, benefit:corpus_fund_management -->
Every flat has its own running Dr/Cr ledger — bills raised, payments received, and the running
balance are all visible to that resident and to the building admin, with a full audit trail. There
is no separate "black box" spreadsheet the committee maintains offline; the ledger the resident
sees is the same ledger the treasurer works from. See the Financial Ledger Logic document for the
mechanics.

## Administrative Transparency & Control

<!-- tags: benefit:transparent_ledger -->
Building admins and committee members get full visibility into dues, collections, and expenses in
one dashboard, with role-based access (Building Admin vs. Committee Member vs. Guard vs. Resident)
so sensitive financial controls stay with the people the society has authorized, while day-to-day
operational visibility (visitor logs, complaints, announcements) is available more broadly.

## Fast, Low-Friction Migration From Spreadsheets

<!-- tags: benefit:fast_migration, objection:spreadsheet_migration -->
Societies currently running on Excel/Google Sheets and a WhatsApp group can move to FLATBRIZ
without a big-bang cutover: flats, residents, and opening balances are set up once (using the
society's existing records), and billing continues seamlessly from the next cycle. Residents keep
their historical dues context migrated in as opening balances rather than starting from zero.

## Dedicated Support During Onboarding

<!-- tags: benefit:dedicated_support -->
New societies get hands-on help configuring their maintenance rules, flats, and committee accounts
during onboarding, rather than being handed a self-serve dashboard and left to figure it out.
