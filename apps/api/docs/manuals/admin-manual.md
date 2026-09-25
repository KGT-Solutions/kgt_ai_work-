# FLATBRIZ Building Admin & Committee Manual

This manual covers the admin-facing features of FLATBRIZ (Building Admin, Committee Member, and
Super Admin roles): building setup, memberships, finance, moderation, and reporting. It is the
source of truth for the Support Chatbot when answering building admins and committee members.
Admins can also be answered from the Resident Manual for resident-facing questions.

## Roles & Permissions

FLATBRIZ has five roles: Super Admin, Building Admin, Committee Member, Guard, and Resident.
Building Admins manage a single building end-to-end. Committee Members share most of a Building
Admin's moderation abilities (approving complaints, posting announcements) but typically cannot
change building-wide finance configuration. Super Admins operate across all buildings and handle
platform-level bug reports and building onboarding.

## Building Setup & Building Code

Each building has a unique Building Code (e.g. GRM4821) used by residents to sign up. Building
Admins configure the building's name, address, and flats/units during setup. Share the Building
Code only with verified residents to prevent unauthorized signups.

## Approving Memberships

New resident signups appear as "pending" memberships. From the admin web panel's Residents
section, Building Admins and Committee Members review each request (matching the claimed flat)
and approve or reject it. Only approved members can access building features such as bills,
visitors, and facilities.

## Maintenance Configuration & Bills

Building Admins configure the maintenance billing cycle: base maintenance amount per flat, sinking
fund contribution, due date, and late fee rules, under Finance → Maintenance Config. Once
configured, bills are generated automatically each billing period for every flat. Admins can view
generated bills, mark manual payments, and issue corrections if a bill was generated incorrectly.

## Finance & Expense Tracking

The Finance section shows collected dues, outstanding dues per flat, and (where enabled) expense
tracking for building outgoings. Use this to reconcile the building's accounts and respond to
resident billing questions.

## Managing Complaints

Complaints raised by residents appear in the admin panel's Complaints section, organized by
category and status (open, in review, resolved). Building Admins and Committee Members should
update the status as they work a complaint and can add resolution notes visible to the resident.

## Visitor Oversight

Admins can review visitor logs recorded by guards (entries/exits, pre-approved Gate Passes) for
security auditing. If a guard flags an unrecognized visitor, the admin should follow up with the
relevant resident.

## Facilities Management

Building Admins configure which amenities are bookable, their available time slots, and whether a
booking requires admin approval. Pending facility bookings needing approval appear in the admin
panel; approve or reject them there.

## Announcements & Polls

Building Admins and Committee Members can post announcements visible to all residents (maintenance
notices, events, outages) and create polls/votes for resident decisions (e.g. budget approvals).
Set a poll's closing time and whether results are visible before or only after closing.

## Emergency Contacts

Building Admins maintain the Emergency Contacts list (security desk, admin, hospital, fire,
police) shown to residents and guards. Keep these numbers current, especially the security desk
and on-call admin contact.

## Bug Reports & Support Tickets

Bug reports submitted by residents via Profile → Report a Bug are routed to the building's
configured support email, or to Super Admins if none is configured. Building Admins can view and
update bug report status (open, in review, resolved) from the admin panel's Bugs section. Reports
submitted more than 5 times per hour by the same user are rate-limited automatically.

## Notifications

Admin actions such as posting an announcement, approving a facility booking, or updating a
complaint trigger in-app notifications to the affected residents automatically — no separate
notification step is required.

## Getting Further Help

For platform-level issues (billing disputes with FLATBRIZ itself, account recovery, or requests
unrelated to app functionality), Building Admins should escalate via Profile → Report a Bug so it
reaches the Super Admin team, or check this manual and the Resident Manual for the relevant
feature before escalating.
