# Orb Console design system

The design system behind the Orb client console (the dashboard a clinic uses to set up, install and run Orb).

- **Source of truth:** Figma file `apkG81U1gfislOJsKjOmyG`, page **Orb Dashboard (Sidharth)**, section **Design system · Orb Console** (node `601:2005`). Components live in section **14 · Components** (`439:802`).
- **Example clinic used in every screen:** Sanvi Fertility & IVF, Pune (fictional).
- **Version:** 18 Nov 2026. Values were read from the file's variables and styles, then checked across 21,588 layers on 62 screens.
- **Platform:** desktop, 1440 wide. Mobile is not designed yet.

---

## 1. Principles

1. **Neutral first.** Black, white and greys carry the interface. Colour appears only when it means something.
2. **Yellow means "needs you".** The yellow marker shows what needs action, the current step and anything out of date. Text on yellow is always dark grey.
3. **No red.** Errors are written in words and carry the yellow marker, never colour alone. Whether to add a dedicated error colour is still open.
4. **One main button.** Each view has one Primary (dark) button. Everything else is Secondary (outlined) or a text link.
5. **One number per fact.** A figure keeps the same value and rounding on every page, with its reason and next step close by.
6. **Desktop 1440 first.** Every console screen is 1440 wide. Mobile comes later.

---

## 2. Colour

There are 12 variables in the Figma collection **Orb Colours**. Bind every fill, stroke and text colour to one of them, and never paste a hex value.

| Token | Hex | On white | With dark grey | Use |
|---|---|---|---|---|
| **Brand** | | | | |
| `orb/dark-grey` | `#202020` | 16.3:1 | — | Main text, primary buttons, done markers, flow arrows, shadow colour |
| `orb/white` | `#FFFFFF` | — | 16.3:1 | Cards, panels, inputs, text on dark grey or blue |
| `orb/electric-yellow` | `#F2F05C` | 1.2:1 | 13.5:1 | "Needs you" marker, current step, New / Outdated / Failed pills. Dark text only |
| `orb/vivid-blue` | `#5C5EF2` | 4.8:1 | 3.4:1 | Booked pill; Orb accent in the chat widget. White text on it |
| `orb/blue-tint` | `#C6C7FA` | 1.6:1 | 10.0:1 | Orb's messages and the message box in the chat; Tint pills (Live, Guide sent, Showed up) |
| **Surfaces and lines** | | | | |
| `orb/surface-base` | `#EEEEEE` | 1.2:1 | 14.0:1 | Page background behind cards |
| `orb/surface-subtle` | `#F6F6F6` | 1.1:1 | 15.1:1 | Notes, table headers, inner panels, placeholder lines, code boxes |
| `orb/hairline` | `#E8E8E8` | 1.2:1 | 13.3:1 | Card borders and dividers |
| `orb/light-grey` | `#DEDEDE` | 1.3:1 | 12.1:1 | Visitor messages in the chat only. Too faint for borders or data |
| `orb/chip-stroke` | `#909090` | 3.2:1 | 5.1:1 | Borders of inputs, selects, secondary buttons and chips (meets 3:1); secondary chart lines |
| **Text** | | | | |
| `orb/dark-grey` | `#202020` | 16.3:1 | — | Main text and headings |
| `orb/text-secondary` | `#5C5C5C` | 6.7:1 | — | Descriptions, helper text, captions |
| `orb/text-tertiary` | `#666666` | 5.7:1 | — | Placeholders and timestamps (see Gaps) |

**Rules**
- Status colour lives only in pills and markers, never on whole rows or on text.
- Flow diagrams and arrows use dark grey only, never brand colours.
- The scrim behind panels and dialogs is a dark-grey rectangle at **32% layer opacity**, covering the whole frame. Use layer opacity: paint opacity on a bound colour renders solid.
- Shadows use `#202020` at the stated opacity. Effect colours aren't bound to the variable because binding drops the opacity.
- In plugin scripts, give a bound paint the token's real colour as its base, or it can render black or white.
- Long canvas boards may use a white-to-transparent scroll fade, on the canvas only.

---

## 3. Typography

### 3.1 Fonts

| Family | Weights used | Where | CSS stack |
|---|---|---|---|
| **Inter** | Regular 400 · Medium 500 · Semi Bold 600 | Everything in the console and the chat widget: body, labels, buttons, figures, card titles (about 5,900 text layers) | `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| **Montserrat** | Bold 700 only | Page titles (`Console/Page title`) and the signup heading. Never for body text, labels or figures | `Montserrat, Inter, system-ui, sans-serif` |
| **JetBrains Mono** | Regular 400 only | Code: install snippets, API keys, server replies (`Console/Code`) | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` |
| **Arimo** | Bold 700, logo only | The "Orb" wordmark inside `Orb/Lockup`. Never type with it | Not used in code; export the logo as SVG |

- Inter, Montserrat and JetBrains Mono are free on Google Fonts (SIL Open Font License).
- **Open:** the wordmark layer note says to swap Arimo Bold for Helvetica Bold.
- **Open:** confirm Montserrat stays for page titles, or switch titles to Inter Semi Bold.

Always apply a text style; never set font, size or weight by hand. The base size is 13 px.

### 3.2 Console styles (the dashboard)

Sizes step 11 · 12 · 13 · 16 · 20 · 26 · 28 · 40.

| Style | Font | Size / line height | Letter spacing | Use |
|---|---|---|---|---|
| `Console/Display` | Inter Medium | 40 / 44 | −3% | Hero figures: readiness score, the main number of a page |
| `Console/Figure` | Inter Semi Bold | 28 / 34 | −2% | Figure cards and scores |
| `Console/Page title` | Montserrat Bold | 26 / 32 | −1% | One per page, top left; signup heading |
| `Console/Figure small` | Inter Semi Bold | 20 / 28 | −1% | Secondary figures, code digits, small stats |
| `Console/Card title` | Inter Semi Bold | 16 / 24 | −1% | Titles of cards, panels and dialogs |
| `Console/Heading` | Inter Semi Bold | 13 / 20 | −0.6% | Table headings, row titles, funnel step names |
| `Console/Body strong` | Inter Medium | 13 / 20 | −0.6% | Names, entry titles, **Default button labels**, emphasis |
| `Console/Body` | Inter Regular | 13 / 20 | −0.6% | Default text: messages, table cells, inputs |
| `Console/Small strong` | Inter Semi Bold | 12 / 16 | −0.6% | Labels that lead a note or warning |
| `Console/Small medium` | Inter Medium | 12 / 16 | −0.6% | **Small button labels**, field labels, links, pills |
| `Console/Small` | Inter Regular | 12 / 16 | −0.6% | Descriptions, helper text, captions, timestamps |
| `Console/Micro` | Inter Medium | 11 / 16 | 0% | Keyboard hints, step numbers. Use sparingly |
| `Console/Code` | JetBrains Mono Regular | 12 / 20 | 0% | Snippets, keys, server replies |

### 3.3 Widget styles (the chat visitors see)

These run larger than the console because patients read them on the clinic's own site.

| Style | Font | Size / line height | Use |
|---|---|---|---|
| `Widget/Title` | Inter Semi Bold | 20 / 28 | Chat header |
| `Widget/Message` | Inter Regular | 18 / 26 | Every message bubble |
| `Widget/Button` | Inter Medium | 16 / 24 | Buttons in action cards |
| `Widget/Body` | Inter Regular | 15 / 22 | Form text inside action cards |
| `Widget/Label` | Inter Medium | 14 / 20 | Field labels |
| `Widget/Small` | Inter Regular | 13 / 18 | Disclosure line, timestamps |

### 3.4 Canvas styles (Figma notes only, never inside a screen)

| Style | Font | Size / line height | Use |
|---|---|---|---|
| `Canvas/Section title` | Inter Semi Bold | 96 / 135% | Section names |
| `Canvas/Section description` | Inter Regular | 32 / 135% | Section descriptions |
| `Canvas/Title` | Inter Semi Bold | 20 / 28 | Titles of rules, audit and note cards |
| `Canvas/Lead` | Inter Regular | 18 / 26 | Lead lines in annotation cards |
| `Canvas/Strong` | Inter Medium | 16 / 24 | Row titles, strong labels in notes |
| `Canvas/Body` | Inter Regular | 15 / 22 | Body text of annotation cards |
| `Canvas/Label` | Inter Medium | 14 / 20 | Table headers and labels in audit cards |
| `Canvas/Caption` | Inter Regular | 13 / 18 | Captions and small print |

The `Desktop/*`, `Tablet/*` and `Mobile/*` styles in the file belong to the Orb marketing site and are never used in the console.

---

## 4. Spacing

All spacing comes from one scale. The two values to remember: **28** inside and between cards, and **40** around the page.

| Token | Value | Use |
|---|---|---|
| `space-2` | 2 | Title to its description; line pairs |
| `space-4` | 4 | Label to value in tight stacks; caption lines |
| `space-6` | 6 | Field label to input; pill and chip inner gap |
| `space-8` | 8 | Icon to text; buttons in a group; table row items |
| `space-10` | 10 | Step tracker parts; chip groups; code boxes |
| `space-12` | 12 | Related controls side by side; inner panel padding |
| `space-14` | 14 | Sidebar item gap and padding; note padding |
| `space-16` | 16 | Items in a panel; table cell gaps; list padding |
| `space-20` | 20 | Blocks inside a card or panel; panel side padding |
| `space-24` | 24 | Panel and card header top padding |
| `space-28` | 28 | Card padding and the gap between cards (always equal) |
| `space-32` | 32 | Page top padding; top bar left padding |
| `space-40` | 40 | Page side and bottom padding |

- **Layout spacing above 40:** 56 at the top of log-in and first-time cards, 72 for empty and error states, 80 at the bottom of signup pages.
- **The chat widget has its own rhythm:** bubble padding 14/18, window padding 20. Don't reuse it in the console.
- **Gap:** there are no spacing variables yet; these are conventions.

---

## 5. Corner radius

Bigger containers get bigger corners. Inside a card, nested corners are always smaller than the corner around them.

| Token | Value | Use |
|---|---|---|
| `radius-3` | 3 | Score and data bars (top corners), checkbox |
| `radius-6` | 6 | Pills, ⌘K hint |
| `radius-8` | 8 | Buttons, inputs, select, nav items, workspace avatar |
| `radius-10` | 10 | Notes, warnings, gap rows |
| `radius-12` | 12 | Inner panels, tables inside cards, code boxes, the main content shell |
| `radius-16` | 16 | Cards, side panels, dialogs, popovers, signup cards |
| `radius-full` | 999 | Toggles, avatars, step markers |

- The main shell (r12) is a surface, not a card, so the r16 cards on it are not "nested" in the rule's sense.
- The chat widget has its own scale: window 25, images 24, bubbles 20, buttons and avatar 14.

---

## 6. Borders and elevation

### Borders

| Name | Spec | Use |
|---|---|---|
| Hairline | 1 px `orb/hairline` | Cards, dividers, table rows |
| Control | 1 px `orb/chip-stroke` | Inputs, selects, secondary buttons, chips, empty step markers |
| Focus | 2 px `orb/dark-grey`, inside | Focused input, the active code box |
| Planned / edge | 2 px dark grey, dashed 8/6 | Planned-feature notes on the canvas; edge-case flow arrows |

Never put a 1 px stroke and a 1 px inner-shadow ring on the same box; that draws a double border.

### Elevation

| Level | Recipe | Use |
|---|---|---|
| 0 · Page | No shadow, `surface-base` | Page background |
| 1 · Card | White, r16, 1 px hairline; no drop shadow | Every card |
| 1 · Raised control | `0 1 2` 5% + 1 px ring 8% | Workspace switcher, active nav item, Orb status card, selected segment |
| 1 · Main shell | `0 1 3` 4% + 1 px ring 7% | The white area right of the sidebar |
| 2 · Popover, menu, toast | `0 8 24` 10% + 1 px ring 8% | Details popovers, ⋯ menus, toasts, chart tooltips |
| 2 · Side panel | `0 12 32` 8% | Right-side sheets, over the scrim |
| 3 · Dialog | `0 16 48` 18% | Centred dialogs, over the scrim |

---

## 7. Layout

| Part | Spec |
|---|---|
| Frame | 1440 wide, at least 900 tall. 8 px above and below the main shell. In 900-tall frames the shell is clipped at 884 |
| Sidebar | 232 wide. Padding 14 top, 12 right and bottom, 16 left; gap 14. Groups: Overview · Build · Install · Results · Settings. Clinic switcher at the top; Orb status card and the user at the bottom |
| Main shell | 1200 wide, white, r12, at x 232 |
| Top bar | 52 tall, padding 32 left / 24 right: breadcrumb, search (⌘K), bell, "Preview on your site" |
| Content | 32 top, 40 sides and bottom, 28 between blocks; 1120 wide |
| Grid | Two columns of 612 + 28 + 480, or one full-width block of 1120 |
| Side panel | 520 × 860, 20 from the top and right edges, over the scrim |
| Dialog | 400–520 wide, centred, over the scrim |
| Signup and log in | No sidebar. Top bar padding 20/40. Column 880 (steps, knowledge, bots, review); forms 560 (also the paused card); log in and sign in 460 |
| Chat widget | 720 wide on desktop; samples are 820 tall |

---

## 8. Components

There are 11 console components in section 14, plus the Orb logo and mark (main components on the page "idk"). Use instances and change them through their properties; never detach them.

| Component | Properties | Use |
|---|---|---|
| **Console/Button** | Style: Primary, Secondary · Size: Default (32), Small (28) · Label | One Primary per view. Hugs its label. Default label `Body strong` 13; Small label `Small medium` 12. r8, padding 12 (10 small) |
| **Console/Pill** | Tone: Yellow, Tint, Blue, Neutral, Outline · Size: Default (22), Small (20) · Label | Status and category labels; tone follows the table below. r6 |
| **Console/Chip** | Selected: Yes, No · Label · Count | Filter chips and tabs with a count, e.g. "Booked 58" |
| **Console/Phrase chip** | Label | A removable token: recipients, how visitors asked |
| **Console/Gap chip** | Label | A knowledge gap, always next to a way to fill it |
| **Console/Checkbox** | State: On, Off | Consent and multi-select. r3 |
| **Console/Toggle** | State: On, Off | Switches that act straight away (emails, bots) |
| **Console/Select** | Size: Small (28), Default (38) · Label | Single choice. Small in tables, cards and toolbars; Default next to text inputs. FIXED width; the chevron pins right |
| **Console/Banner** | Type: Blocking, Needs you, Info · Title · Body · Show action | Page-level message above the content. Blocking (dark) when Orb can't work; Needs you for action; Info for a note |
| **Flow/Label** | Type: Action, Automatic, Edge · Label | Canvas only. Action is a dark pill with the exact button text; Automatic is a 2 px chip-stroke outline with "When…"; Edge is dashed |
| **Flow/Marker** | Type: Start, End · Label | Canvas only. Start and end of a flow |
| **Orb/Lockup** | — | Mark + wordmark, top left of the sidebar and signup pages |
| **Orb/Icon Mark** | — | The two-ellipse mark: status card, chat header, Orb avatar. Scale with `rescale()`, not `resize()` |

### Pill tone table

| Tone | Means |
|---|---|
| Yellow | Needs you, New, Outdated, Failed, Below Ready, current step |
| Blue | Booked |
| Tint | Live, Guide sent, Showed up |
| Neutral | Plain states and categories, score levels (Ready, Moderate), Skipped, Saved, Contacted |
| Outline | Planned or Draft only |

---

## 9. Patterns (not components yet)

These pieces are copied between screens. Each should become a component; until then, copy them from the screen named.

| Pattern | Spec | Where |
|---|---|---|
| Step tracker | 5 steps; bar 4 px; done = dark marker with ✓, current = yellow marker + bold label, next = outlined marker + tertiary label | Signup 0A–0F |
| Text field | Label (`Small medium`) · input 38 tall, r8, 1 px control border, padding 0/12 · helper (`Small`) | Signup, Email, Actions |
| Code entry | Six 56 × 56 boxes in two groups of three with a dash between; `surface-subtle`, r12, no border; empty boxes show a faint 0; the active box has the 2 px focus border and a cursor | 0B, 0H |
| Warning row | Grey box (`surface-subtle`, r10) + yellow pill + bold line + one sentence | Signup, Knowledge, Email |
| Note | Grey box with a bold lead line; explains a rule and never asks for action | Everywhere |
| Score bar | Hairline track, dark-grey fill, marker at 80 labelled "Ready 80" | 0E, readiness |
| Sidebar, Top bar | See Layout. The sidebar is copied 44 times | Every console screen |
| Side panel, Dialog, Table row, Card header/footer, Toast | See Layout and Elevation | Many screens |
| Chat window parts | Header, bubbles, action card, quick replies | 3C–3J, 12I–12K |

---

## 10. Writing and formats

| Topic | Rule |
|---|---|
| Case | Sentence case everywhere; no all caps |
| Dates and times | `Tue 3 Nov, 10:42 pm`. Whole hours drop ":00": `10 am`. Ranges use an unspaced en dash: `9–11 pm` |
| Separators | A middle dot with spaces: `Hinglish · /ivf-cost` |
| Money | ₹ with Indian grouping: `₹1,65,000`. Per unit: `₹4.62 per conversation` |
| Numbers | One value per fact, rounded the same on every page, with its reason and next step close by |
| Punctuation | Curly quotes and apostrophes; the `…` character |
| Buttons | Say what happens: "Send code", "Add the answer", "Create workspace & test Orb". Never "OK" or "Submit" |
| First-time screens | Say what will show and how: "Leads will show here", "Waiting for your first lead". Never "empty", "no data" or "nothing yet" |
| Errors | What happened in plain words, one next step, what's safe, no blame, placed where the problem is |
| Live or not | Anything not live carries Planned, Proposal or Draft |
| Names | One name per thing: Test Orb (not "Test bots"), Book a first consultation, Knowledge readiness |

---

## 11. Gaps (open)

1. **No error colour.** Errors use the yellow marker and words. Decide whether to add a red token; it would need a contrast check.
2. **No focus ring on any component.** Add a Focus variant: 2 px dark grey with a 2 px offset.
3. **Button lacks variants.** There are no Destructive, Disabled, Loading or Icon-only versions, so "Revoke and take Orb offline" looks like a safe action.
4. **No spacing or radius variables.** The scales above are conventions only.
5. **`text-tertiary` (#666) is almost the same as `text-secondary` (#5C5C5C).** Lighten it to about #767676.
6. **Small click targets.** Toggle (32 × 18) and Checkbox (16 × 16) are under the 24 px minimum.
7. **Icon-only buttons need labels.** The bell, gear, ⋯ and × need a written label and a tooltip.
8. **Copies instead of components.** The sidebar, top bar, inputs, panels and dialogs are copied, not components.
9. **Old v2 frames.** 4A (Test Orb) and 13A (Conditional states) still break several rules; rebuild them in v3.
10. **No mobile.** Mobile sizes and breakpoints aren't defined yet.

---

## 12. Change log

- **18 Nov 2026:** first version. On the same day, every screen was brought in line with this document:
  - removed 196 double borders;
  - added the Select 38 size and made the Button hug its label;
  - added the pill tone table;
  - added the Canvas text styles;
  - snapped paddings and radii to the scales;
  - normalised shadows;
  - styled 27 mixed-weight texts;
  - fixed time formats.
