# Emerald Fresh â€” Design System

Visual system for the **Society Management** app (green theme). Extracted from the "Book Amenity" screen.

---

## 1. Color

### Brand / accent
| Token | Value | Use |
|---|---|---|
| Primary | `#059669` | Icons, prices, links, "View all", active outlines |
| Primary light | `#34d39a` | Top of gradients, highlights |
| Primary gradient | `linear-gradient(180deg, #34d39a, #059669)` | CTAs, selected date/time chips |

### Surfaces & background
| Token | Value | Use |
|---|---|---|
| Screen background | `linear-gradient(180deg, #effdf5 0%, #d3f6e3 44%, #eafaf1 100%)` | App canvas |
| Card / surface | `#ffffff` | Cards, chips, search, nav |
| Device bezel | `#0e0e12` | Phone frame |

### Text
| Token | Value | Use |
|---|---|---|
| Heading / primary | `#06231a` | Titles, headings, key values |
| Secondary | `#2f5c4a` | Body, sub-labels, chip text |
| Muted | `#7ba392` | Captions, hints, "(Optional)", placeholders |
| On-primary | `#ffffff` | Text/icons on gradient |

### Utility
| Token | Value | Use |
|---|---|---|
| Star / rating | `#f6b73c` | Rating star only |
| Chevron muted | `#9dc4b3` | Row disclosure arrows |
| Field rest bg | `#f2fbf6` | Input fill at rest |
| Field border | `#cbe8db` | Input hairline, tile ring |
| Track / inactive | `#e2f2ea` | Segmented track, progress track, disabled chips |
| Disabled bg | `#eef3f0` | Booked slot, disabled input |

### Status badges
All tinted within the emerald family (no outside hues except a warm "due").
| State | Text | Background | Use |
|---|---|---|---|
| Success / Paid / Inside | `#0a7a55` | `#cdf3e2` | Positive status |
| Pending / Due | `#8a6a2f` | `#f4ead1` | Awaiting action (only warm accent) |
| Neutral / Submitted | `#4f7a67` | `#dbeee5` | Informational |

---

## 2. Typography

**Family:** `Plus Jakarta Sans` (Google Fonts), weights 400/500/600/700/800. Fallback `system-ui, sans-serif`.

| Role | Size | Weight | Color |
|---|---|---|---|
| Screen title | 17px | 800 | `#06231a` |
| Section heading | 14px | 800 | `#06231a` |
| Card title | 14px | 700 | `#06231a` |
| Price / value | 13px | 800 | `#059669` |
| Body / chip | 12px | 600 | `#2f5c4a` |
| Caption / hint | 10.5â€“11px | 500 | `#7ba392` |
| "View all" link | 11px | 600 | `#059669` |
| Button label | 15px | 700 | `#fff` |

Line-height: `1` for labels/values, `1.3` for wrapping body text.

---

## 3. Shape & spacing

| Token | Value |
|---|---|
| Screen radius | 42px (bezel 52px) |
| Card radius | 16â€“18px |
| Chip / pill radius | 14px (time), 16px (date), 22px (category) |
| Button radius | 28px (full pill) |
| Icon button | 42px circle |
| Card padding | 10â€“14px |
| Gap between chips | 9px |
| Section top margin | 16â€“18px |

---

## 4. Elevation (shadows)

| Level | Value | Use |
|---|---|---|
| Card | `0 14px 30px -20px rgba(6,60,40,.6)` | White cards |
| Soft row | `0 12px 26px -20px rgba(6,60,40,.6)` | Address/list rows |
| Icon button | `0 6px 16px -8px rgba(6,60,40,.5)` | Circular buttons |
| Active chip | `0 10px 20px -8px rgba(5,150,105,.9)` | Selected date/time |
| Primary CTA | `0 18px 34px -14px rgba(5,150,105,.95)` | Book / Confirm button |

---

## 5. Components

**Top bar** â€” 42px circular back button (white) Â· centered 17px/800 title Â· 42px circular kebab menu. Icons stroke `#059669`.

**Summary card** â€” white, radius 18, padding 10. Left: 88Ã—88 image (radius 14). Right: title, primary-color price, secondary meta lines, amber star + rating.

**Selector chips (date/time)** â€” flex row, `gap:9px`, equal-width. Default: white, muted/secondary text. Selected: primary gradient fill, white text, active-chip shadow.

**List row** â€” white, radius 16. Leading outline icon (`#059669`), title `#06231a` + muted subtitle, trailing chevron `#9dc4b3`.

**Section header** â€” 14px/800 heading left, 11px/600 `#059669` "View all" right, baseline-aligned.

**Primary button** â€” full-width, 56px tall, radius 28, primary gradient, 15px/700 white label, CTA shadow.

**Secondary button** â€” white fill, `#059669` label, 1.5px `#cbe8db` border, radius 28. For "Cancel" / low-emphasis actions.

**Destructive button** â€” white fill, `#c2503f` label + icon, no gradient. (Log out, delete.) Danger stays a warm red â€” the only non-green action color.

**Segmented control** â€” track `#e2f2ea`, radius 14; active segment = primary gradient pill + white text; inactive = transparent + `#7ba392`. (e.g. OTP / Password, Active / Resolved.)

**Icon tile / quick link** â€” white card, radius 18, soft card shadow, with a 44px rounded-14 tinted icon tile + 12px/600 `#2f5c4a` label below. Keep tiles in-family: tile bg `#d3f6e3`, glyph `#059669`. Selected tile gets a 1.5px `#059669` ring.

**Status badge** â€” pill, radius 20, 11px/600, colors per Â§1 status table.

**Progress bar** â€” 4px track `#e2f2ea`, primary gradient fill, rounded; % shown in `#059669`.

**Bottom nav** â€” white bar, top hairline `#e2f2ea`, tabs = icon + 11px label. Active `#059669`; inactive `#7ba392`. (Or the floating rounded variant used on Home.)

**FAB** â€” 56px circle, primary gradient, white glyph, CTA shadow.

**Empty state** â€” centered line-icon (~44px, `#9dc4b3`), title 16/600 `#06231a`, one-line hint `#7ba392`.

---

## 6. Forms &amp; inputs

All inputs sit on the white/light-emerald surface â€” never grey. Focus is always the emerald ring.

| Element | Spec |
|---|---|
| Field label | 13px/600 `#06231a` above field, or UPPERCASE 11px/600 `+0.06em` `#7ba392` |
| Text input | bg `#f2fbf6`, radius 14, padding 14px 16px, 14px `#06231a` value, placeholder `#7ba392`, 1px `#cbe8db` border |
| Focus | border `#059669` + ring `box-shadow:0 0 0 3px rgba(5,150,105,.18)` |
| Filled / valid | keep border `#cbe8db`; optional trailing check in `#059669` |
| Error | border `#c2503f`, helper text `#c2503f` |
| Disabled | bg `#eef3f0`, value `#9dc4b3`, no border |
| Prefix field | inline `+91` in `#06231a`, 1px `#cbe8db` divider, then input |
| Textarea | same as input, min-height 96px, radius 16 (e.g. "Add Note") |
| Select / dropdown | input styling + trailing chevron `#9dc4b3`; open menu = white card, selected row tinted `#d3f6e3` with `#059669` check |
| Checkbox / radio | 20px, radius 6 (box) / full (radio); unchecked border `#cbe8db`; checked = primary gradient fill + white glyph |
| Toggle | track `#e2f2ea` off / primary gradient on; white 20px knob |
| Helper text | 12px `#7ba392` below field |
| Submit | full-width primary gradient button (see Â§5) |

```css
/* input (rest) */
background:#f2fbf6; border:1px solid #cbe8db; border-radius:14px;
padding:14px 16px; color:#06231a; font:500 14px 'Plus Jakarta Sans';
/* input placeholder */
color:#7ba392;
/* input:focus */
border-color:#059669; box-shadow:0 0 0 3px rgba(5,150,105,.18);
/* checkbox/toggle ON */
background:linear-gradient(180deg,#34d39a,#059669);
```

---

## 7. Recipe snippets

```css
/* primary gradient (buttons, active chips) */
background: linear-gradient(180deg, #34d39a, #059669);

/* screen background */
background: linear-gradient(180deg,#effdf5 0%,#d3f6e3 44%,#eafaf1 100%);

/* white card */
background:#fff; border-radius:18px;
box-shadow:0 14px 30px -20px rgba(6,60,40,.6);

/* primary CTA */
height:56px; border-radius:28px; color:#fff; font:700 15px 'Plus Jakarta Sans';
background:linear-gradient(180deg,#34d39a,#059669);
box-shadow:0 18px 34px -14px rgba(5,150,105,.95);
```