hello thre
# Green Meadows — Society App Design System

Design system extracted from the live app screens (Login, Home, Bills, Vote, Complaints, Notifications, Book Facility, Visitors, Announcements, Marketplace, Profile, Personal Details, Vehicles, Vendor Services, SOS/Directory).

A calm, utilitarian community app: light-grey canvas, white cards, a **dark slate** primary for structure/CTAs, a **sage green** accent for positive actions, and **pastel icon tiles** for wayfinding.

---

## 1. Color

### Core
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#f2f3f4` | App canvas (all screens) |
| `--surface` | `#ffffff` | Cards, inputs, nav, sheets |
| `--primary` | `#2b3a49` | Dark-slate: bill card, primary buttons, active tabs, headings on light |
| `--primary-ink` | `#1f2d3a` | Headings / titles |
| `--accent` | `#7d9471` | Sage green: "Pay now", "Send OTP", selected chips, progress fill |
| `--accent-ink` | `#5f7d52` | Green text: links ("See all", "Signup"), active states, vote % |
| `--danger` | `#a9503f` | Terracotta: SOS, "Log out", destructive |

### Text
| Token | Hex | Use |
|---|---|---|
| `--text` | `#1f2d3a` | Primary text, titles |
| `--text-body` | `#4b5563` | Body copy, descriptions |
| `--text-muted` | `#8a94a0` | Sub-labels, captions, meta |
| `--label` | `#9aa4ae` | UPPERCASE section labels (letter-spaced) |
| `--on-dark` | `#ffffff` | Text on slate / accent surfaces |

### Status badges
| State | Text | Background | Seen on |
|---|---|---|---|
| Due / In progress / Maintenance | `#b0863f` | `#f3e6cf` | bill "due", complaint "in progress", pinned tag |
| Paid / Inside / Success | `#5f7d52` | `#dde8d5` | bill "paid", visitor "Inside" |
| Submitted / Neutral | `#6b7280` | `#e9ebed` | complaint "submitted", "Event" tag |

### Pastel icon-tile tints
Rounded 14px tiles, ~10% tint fill + saturated glyph. Assign by category:

| Tint | Fill | Glyph | Examples |
|---|---|---|---|
| Blue | `#e4ecf7` | `#5b7fb0` | Book facility, AC repair, Plumbing, Water purifier |
| Green | `#e0ebdb` | `#6d8f63` | Complaints, Deep cleaning, Appliances, Votes |
| Purple | `#eae6f5` | `#8a6db3` | Visitors, Electronics, CCTV, Family, Master-user |
| Orange | `#f7e9d8` | `#c78a4a` | Announcements, Carpentry, Painting |
| Yellow | `#f7efcf` | `#c9a94a` | Electrical |
| Red | `#f6dfd9` | `#b0503f` | Pest control, Ambulance |
| Grey | `#e9ebed` | `#6b7280` | Locksmith, neutral |

---

## 2. Typography

**Family:** neutral grotesque sans (Inter / system-ui). Weights 400/500/600/700.

| Role | Size | Weight | Color |
|---|---|---|---|
| Page title (screen name) | 26–28px | 700 | `--primary-ink` |
| Big amount (₹2,450) | 30px | 700 | `--on-dark` / `--primary-ink` |
| Card / item title | 16–17px | 700 | `--primary-ink` |
| Section heading | 18–20px | 700 | `--primary-ink` |
| Body / description | 13–14px | 400–500 | `--text-body` |
| UPPERCASE label | 11px | 600, `+0.06em` | `--label` |
| Caption / meta | 11–12px | 400 | `--text-muted` |
| Button label | 15px | 600–700 | contextual |
| Link | 13–14px | 600 | `--accent-ink` |

Titles pair with a small society context chip above them.

---

## 3. Shape, spacing, elevation

| Token | Value |
|---|---|
| Card radius | 16px |
| Icon tile radius | 14px |
| Input radius | 12px |
| Button radius | 12px (block) · full pill (chips/CTA) |
| Screen padding | 20px horizontal |
| Card padding | 16px |
| Gap (stack) | 12px · (grid) 12–14px |
| Card shadow | `0 4px 18px -10px rgba(31,45,58,.15)` |
| Elevated CTA shadow | `0 12px 26px -12px rgba(31,45,58,.35)` |
| FAB shadow | `0 10px 24px -10px rgba(31,45,58,.4)` |

---

## 4. Components

**Society context chip** — white rounded pill, small building glyph + "Green Meadows Society · B-402" in `--accent-ink`, 11–12px. Sits above the page title.

**Cards** — white, radius 16, soft shadow. Titles 16/700, body 13/`--text-body`. Used for bills, complaints, announcements, visitors, list rows.

**Feature card (dark)** — slate `--primary` fill, white text, radius 16. Holds the maintenance bill / total due; label uppercase in muted white, big ₹ amount, optional status pill top-right, full-width accent button inside.

**Buttons**
- *Primary (slate):* `--primary` bg, white label, radius 12, block. ("Save changes", "OTP login" active)
- *Primary (accent):* `--accent` bg, white label. Positive actions ("Pay now", "Send OTP").
- *Disabled:* `#9aa3ab` bg, white label (e.g. "Send OTP" before input).
- *Text/link:* `--accent-ink`, 600 ("New member? Signup", "Security guard login", "See all").
- *Destructive:* white bg, `--danger` text + icon, in a card ("Log out").

**Segmented control** — light `#eef0f2` track, radius 12; active segment = slate pill + white text, inactive = transparent + `--text-muted`. (OTP login / Password · Active / Resolved)

**Selector chips (date)** — horizontal scroll row; each pill white with day+date, radius full/16. Selected = `--accent` fill, white text.

**Time-slot grid** — 2-col grid, full-width last cell. States: *Available* white + border `#e3e6e9`; *Booked* muted `#eef0f2` grey text (disabled); *Selected* `--accent` fill white. Legend swatches (13px, radius 4) below.

**Icon tile / quick link** — white card with pastel icon tile (see §1) + label below; 2-col grid. Used for Quick Links and Vendor/Service pickers (selected service tile gets a green border ring).

**List row** — white card, leading pastel icon tile, title + muted subtitle, trailing chevron `#c3cad1` (Profile menu, Vehicles "Add", complaints). Contact rows swap the chevron for a circular call button.

**Status badge** — small pill, 11px/600, colors per §1 table.

**Progress bar** — 4px track `#e6e8ea`, `--accent` fill, rounded. Vote turnout + Yes/No result bars; % shown in `--accent-ink`.

**Bottom nav** — white bar, top hairline `#eceef0`, 5 tabs (icon + 11px label). Active = `--primary`; inactive = `--text-muted`. Tabs: Home · Bills · Complaints · Directory · Profile.

**FAB** — 56px circle. Accent green (Complaints "+") or slate (Marketplace "Post a listing"), white glyph, FAB shadow.

**SOS button** — large terracotta `--danger` circle with soft glow ring, white "SOS", centered on the emergency screen.

**Empty state** — centered muted line-icon (~44px, `#c3cad1`), title `--text` 16/600, one-line hint `--text-muted`. (Notifications, Vehicles, Family members.)

---

## 5. Forms

Present across Login, Personal Details, Vendor booking.

| Element | Spec |
|---|---|
| Field label | UPPERCASE 11px `--label`, or sentence-case 13/600 `--text` above the field |
| Text input | white bg, radius 12, ~14px padding, 14px `--text` value, placeholder `--text-muted`; no visible border at rest |
| Focus | 1.5px `--accent` ring (`box-shadow:0 0 0 3px rgba(125,148,113,.25)`) |
| Disabled input | `#eceef0` bg, `--text-muted` value, not editable (phone / flat fields) |
| Prefix field | inline `+91` in `--text`, divider, then input (phone number) |
| Helper text | 12px `--text-muted` below field ("Phone is used for login…", "try otp : 123456") |
| Submit | full-width slate or accent button, radius 12 |

---

## 6. Recipe snippets

```css
:root{
  --bg:#f2f3f4; --surface:#fff; --primary:#2b3a49; --primary-ink:#1f2d3a;
  --accent:#7d9471; --accent-ink:#5f7d52; --danger:#a9503f;
  --text:#1f2d3a; --text-body:#4b5563; --text-muted:#8a94a0; --label:#9aa4ae;
}
/* card */
background:var(--surface); border-radius:16px;
box-shadow:0 4px 18px -10px rgba(31,45,58,.15);
/* dark feature card */
background:var(--primary); color:#fff; border-radius:16px;
/* primary accent CTA */
background:var(--accent); color:#fff; border-radius:12px; font:700 15px Inter;
/* input */
background:#fff; border-radius:12px; padding:14px 16px; color:var(--text);
/* input:focus */
box-shadow:0 0 0 3px rgba(125,148,113,.25);
/* section label */
font:600 11px Inter; letter-spacing:.06em; color:var(--label); text-transform:uppercase;
```
