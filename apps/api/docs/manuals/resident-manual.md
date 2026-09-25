# FLATBRIZ Resident & Guard Manual

This manual covers the resident-facing features of the FLATBRIZ app: login, bills, complaints,
visitors, facilities, announcements, polls, family members, vehicles, marketplace, emergency
contacts, and reporting bugs. It is the source of truth for the Support Chatbot when answering
residents and guards.

## Logging In

FLATBRIZ uses phone-number login with a one-time password (OTP). Enter your registered mobile
number on the login screen and request an OTP. The OTP is delivered by email (if OTP_DELIVERY is
set to "email") or by WhatsApp/SMS via Twilio Verify, depending on how your building has
configured delivery. Enter the 6-digit code within its validity window to sign in. If you don't
receive a code, use "Resend OTP" after the cooldown timer expires, and check that your registered
phone number and email are correct under Profile.

## Joining a Building

New residents join a building using the building's unique Building Code (shown to you by your
building admin, e.g. GRM4821). During signup, select your building by its code, then choose your
flat/unit from the list of vacant flats. Your membership request is marked "pending" until a
building admin or committee member approves it. You cannot access building features until your
membership is approved.

## Home Dashboard

The Home dashboard summarizes your outstanding maintenance dues, recent announcements, open
complaints, and quick links to Visitors, Facilities, and Emergency Contacts. Notifications appear
as a bell icon and cover bill reminders, visitor approvals, complaint updates, and announcements.

## Maintenance Bills & Payments

Under Bills, residents can view monthly maintenance bills generated for their flat, see the
breakdown (base maintenance, sinking fund, any late fees), and check due dates. Bills are
generated automatically by the building's maintenance configuration each billing period.

To pay a bill: open it from the Bills tab and view the building's UPI payment QR code, pay the
amount using any UPI app, then upload a screenshot of your payment confirmation on that bill —
this marks it as pending review. Your building admin verifies the payment and confirms it, after
which the bill shows as paid. A bill cannot be marked paid without a payment screenshot.

If a bill looks incorrect, use Profile → Report a Bug or contact your building admin — residents
cannot edit bill amounts themselves. The Finance section (where enabled) shows payment history and
receipts.

## Complaints

Residents can raise a complaint from the Complaints tab: choose a category, describe the issue,
and optionally attach a photo. You can track the status of your complaint (open, in review,
resolved) and add follow-up comments. Building admins and committee members are notified of new
complaints and are responsible for resolving them.

## Visitor Management & Gate Pass

Residents can pre-approve visitors from the Visitors tab by entering the visitor's name and phone
number; this generates a Gate Pass code the visitor (or the guard) can use at the gate. Guards use
the Visitors tab at the gate to log walk-in visitors, verify pre-approved Gate Pass codes, and
record entry/exit times. Denied or unrecognized visitors should be reported to the building admin.
If a visitor's code doesn't scan or match, the guard should call the resident directly using the
phone number shown against the pre-approval before allowing entry.

## Facilities Booking

The Facilities tab lists bookable amenities (e.g. clubhouse, party hall, gym slots). Residents pick
a facility, choose an available date/time slot, and confirm the booking. Bookings may require
building admin approval depending on the facility's settings. Cancel a booking from "My Bookings"
before its start time if your plans change.

## Announcements

Building admins and committee members post announcements (maintenance notices, events, outages).
Residents see these on the Home dashboard and in the Announcements tab, newest first. Announcements
cannot be edited or deleted by residents.

## Polls & Votes

When a poll is open (e.g. approving a budget or an amenity change), eligible residents can cast a
single vote per poll from the Votes tab before the poll's closing time. Results are visible once
the poll closes, per the building admin's settings.

## Family Members

Residents can add family members living in their flat under Family Members in their profile, for
identification and visitor-approval purposes. Each family member entry includes name and
relationship; this list is visible to your building admin.

## Vehicles
<!-- tags: entity:vehicle -->

Register your vehicles (car/bike) with license plate numbers under Vehicles in your profile. This
helps guards and admins verify parking access and match vehicles at the gate.

## Marketplace

The Marketplace tab lets residents list items for sale or exchange within the building community
(e.g. furniture, appliances). Create a listing with a title, description, price, and photo; browse
other residents' listings; and contact the seller directly to arrange a deal. FLATBRIZ does not
process marketplace payments.

## Emergency Contacts

The Emergency Contacts tab lists important numbers for your building: security desk, building
admin, nearby hospital, fire, and police, as configured by your building admin. Guards should keep
this list handy during their shift.

## Notifications

FLATBRIZ sends in-app notifications for bill due dates, visitor approvals, complaint status
changes, and new announcements. Notification preferences are managed from your device's app
settings.

## Reporting a Bug or App Issue

If something in the app isn't working, go to Profile → Report a Bug, choose a category (Login,
Home, Bills, Visitors, Complaints, Finance, Residents, Facilities, Other), and describe the issue
in at least 10 characters. Your building admins (or the super admin, if no support email is
configured) receive the report and will follow up. This is also the right place to send feedback
that the Support Chatbot cannot resolve.

## Getting Further Help

For anything not covered in this manual — including account recovery issues, billing disputes, or
requests unrelated to the FLATBRIZ app — residents and guards should check with their building
admin directly, or use Profile → Report a Bug so the right person can help.
