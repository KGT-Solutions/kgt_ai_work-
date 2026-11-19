const { normalizeHex, hexToHsl, hslToHex, luminance, contrast, mix } = require('./color');

// Widget theme generator for the Bot Branding & Theme Studio. Turns a brand
// kit (brandExtractor.js, or what a client typed in) into three distinct
// widget designs.
//
// Algorithmic rather than an LLM call, deliberately: it runs inside signup,
// so it must be instant, free and impossible to fail — and every colour it
// outputs is checked for readability (WCAG contrast >= 4.5 for text on its
// background, button text on the brand colour, and bubble text), which an
// LLM's palette is not.
//
// Everything a theme contains ends up inside CSS on customers' websites, so
// sanitizeTheme() is the single gate for theme objects (generated, stored or
// read back from JSON), and sanitizeBrand() the gate for brand kits coming
// from a scan or a request body. The widget re-validates on its side too.

const DEFAULT_PRIMARY = '#4f46e5';
const DARK_TEXT = '#0f172a';
const WHITE = '#ffffff';
const MAX_RADIUS = 28;
const MAX_URL_LENGTH = 2048;

const FONT_STACKS = {
  modern: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  rounded: "'Nunito', 'Poppins', 'Segoe UI', sans-serif",
  corporate: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
};
// minimal: the panel's own background · glass: a translucent brand tint ·
// solid: the brand colour · gradient: brand colour into the accent.
const HEADER_STYLES = ['minimal', 'glass', 'solid', 'gradient'];
// Plain characters only — no ; { } ( ) : / \ < > — so a font stack can never
// close the CSS rule it is placed in.
const FONT_STACK_RE = /^[\w\s,'"-]{1,200}$/;
const THEME_ID_RE = /^[a-z0-9-]{1,32}$/;

// How the logo sits in the header (logoBadgeFor below):
//   plain — straight on the header, no plate (it already contrasts)
//   pill  — on a rounded plate of `background`, with padding
//   tile  — edge to edge on a rounded tile filled with the logo's own
//           background colour, so its box blends into the tile
// blend: multiply the image onto its plate, which melts a white image
// background into a white plate. ring: a hairline edge, for a plate that
// would otherwise vanish into a header of the same colour.
const LOGO_BADGE_MODES = ['plain', 'pill', 'tile'];
const LOGO_BACKGROUNDS = ['transparent', 'light', 'dark', 'color', 'complex'];
const DEFAULT_LOGO_BADGE = { mode: 'plain', background: null, blend: true, ring: false, tint: null, variant: null };
// tint recolours a single-colour mark to match the header: 'light' renders it
// white, 'dark' near-black (CSS filters in the widget and the Studio preview).
const LOGO_TINTS = ['light', 'dark'];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Invisible formatting characters (zero-width, bidi marks/overrides/isolates,
// BOM) — as branding.js cleanBotName: ingested text (a site name from a scan)
// must not carry a right-to-left override into the Studio or widget.
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function cleanText(value, max) {
  return String(value ?? '').replace(/[<>]/g, '').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An absolute http(s) URL without credentials, or null. */
function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A font family name safe to quote into a stack ('Poppins'), or null. */
function sanitizeFontName(value) {
  const name = String(value ?? '').replace(/[^A-Za-z0-9 \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return name || null;
}

/** Text that reads best on `bg`: white or the dark ink. */
function onColor(bg) {
  return contrast(WHITE, bg) >= contrast(DARK_TEXT, bg) ? WHITE : DARK_TEXT;
}

/**
 * `hex` darkened (on a light `against`) or lightened (on a dark one) until it
 * reaches `min` contrast with `against`. Keeps the hue, so the brand stays recognisable.
 */
function ensureContrast(hex, against, min = 4.5) {
  let c = hexToHsl(hex);
  const darken = luminance(against) > 0.4;
  for (let i = 0; i < 50 && contrast(hslToHex(c), against) < min; i++) {
    c = { ...c, l: clamp(c.l + (darken ? -0.02 : 0.02), 0, 1) };
  }
  return hslToHex(c);
}

/** logoAnalyzer.js output, validated; null when absent or malformed. */
function sanitizeLogoAppearance(a) {
  if (!a || typeof a !== 'object' || !LOGO_BACKGROUNDS.includes(a.background)) return null;
  const backgroundColor = normalizeHex(a.backgroundColor);
  if (a.background !== 'transparent' && !backgroundColor) return null; // a solid box needs its colour
  return {
    background: a.background,
    backgroundColor: a.background === 'transparent' ? null : backgroundColor,
    tone: a.tone === 'light' ? 'light' : 'dark',
    monochrome: a.monochrome === true,
    // Set by branding.js when a reversed variant of the hosted logo exists.
    ...(a.reversible === true ? { reversible: true } : {})
  };
}

/**
 * A brand kit from a scan or a request body, every field validated.
 * @returns {{ logoUrl: string|null, faviconUrl: string|null, siteName: string|null,
 *   primaryColor: string|null, secondaryColor: string|null, accentColor: string|null,
 *   colors: string[], fontHints: string[], logoAppearance: object|null }}
 */
function sanitizeBrand(input) {
  const b = input && typeof input === 'object' ? input : {};
  const colors = (Array.isArray(b.colors) ? b.colors : []).map(normalizeHex).filter(Boolean);
  const logoUrl = safeUrl(b.logoUrl);
  return {
    logoUrl,
    // Describes the logo it was measured from, so it goes when the logo does.
    logoAppearance: logoUrl ? sanitizeLogoAppearance(b.logoAppearance) : null,
    faviconUrl: safeUrl(b.faviconUrl),
    siteName: cleanText(b.siteName, 120) || null,
    primaryColor: normalizeHex(b.primaryColor),
    secondaryColor: normalizeHex(b.secondaryColor),
    accentColor: normalizeHex(b.accentColor),
    colors: [...new Set(colors)].slice(0, 8),
    fontHints: (Array.isArray(b.fontHints) ? b.fontHints : []).map(sanitizeFontName).filter(Boolean).slice(0, 3)
  };
}

function sanitizeLogoBadge(b) {
  if (!b || typeof b !== 'object' || !LOGO_BADGE_MODES.includes(b.mode)) return { ...DEFAULT_LOGO_BADGE };
  return {
    mode: b.mode,
    background: b.mode === 'plain' ? null : normalizeHex(b.background) || WHITE,
    blend: b.blend === true,
    ring: b.ring === true,
    tint: b.mode === 'plain' && LOGO_TINTS.includes(b.tint) ? b.tint : null,
    // 'reversed': show the logo's reversed variant (branding.js picks its URL).
    variant: b.mode === 'plain' && b.variant === 'reversed' ? 'reversed' : null
  };
}

// The colour of the header behind the logo, near enough.
function headerSurface(t) {
  if (t.headerStyle === 'solid' || t.headerStyle === 'gradient') return t.primaryColor;
  if (t.headerStyle === 'glass') return mix(t.primaryColor, t.backgroundColor, 0.9);
  return t.backgroundColor;
}

/**
 * How a theme seats the logo, from what the logo looks like (logoAnalyzer.js).
 * Always 'plain' — straight on the header, never on a plate, chip or tile: the
 * logo's own background has been removed server-side (logoUpload.js), so only
 * the artwork shows. What varies is keeping that artwork readable:
 *   - already contrasting with the header → shown as-is;
 *   - a single-colour mark that would vanish (black wordmark on a dark header)
 *     → recoloured to the header's ink with a tint;
 *   - a multicolour mark with a reversed variant (dark/neutral lettering
 *     flipped, brand colours kept) → that variant;
 *   - a multicolour mark without one → shown as-is (its colours are all mid
 *     or light, so it still reads; a tint would merge an emblem and the white
 *     shapes inside it into one silhouette);
 *   - a logo whose background couldn't be removed (a photo backdrop, an image
 *     we couldn't download) → on a light header, multiply-blended so a white
 *     box melts into it; otherwise shown as-is.
 * (The 'pill' and 'tile' modes remain valid in sanitizeLogoBadge for old
 * stored themes, but badges are re-derived on read — branding.js themesOf.)
 */
function logoBadgeFor(theme, appearance) {
  const headerIsLight = luminance(headerSurface(theme)) > 0.4;
  const plain = (extra = {}) => ({ mode: 'plain', background: null, blend: false, ring: false, tint: null, variant: null, ...extra });

  if (!appearance || appearance.background !== 'transparent') return plain({ blend: headerIsLight });
  const markIsDark = appearance.tone === 'dark';
  if (markIsDark === headerIsLight) return plain();
  if (appearance.monochrome) return plain({ tint: headerIsLight ? 'dark' : 'light' });
  if (appearance.reversible) return plain({ variant: 'reversed' });
  return plain();
}

// ── Muted header text (inactive Support/Sales tabs, language chips, the close
// button): small text, so WCAG AA asks 4.5:1. It used to be the header ink at
// 60–75% opacity, never checked — 2.87:1 at worst, failing in ~70% of
// generated themes. Now it's the ink faded toward the header only as far as
// 4.5:1 allows, against EVERY surface the header text sits on.

const MUTED_MIN_CONTRAST = 4.5;

/** The colours header text actually sits on: both ends of a gradient; the tinted panel for glass. */
function headerSurfaces(t) {
  if (t.headerStyle === 'gradient') return [t.primaryColor, t.accentColor];
  if (t.headerStyle === 'solid') return [t.primaryColor];
  if (t.headerStyle === 'glass') return [mix(t.primaryColor, t.backgroundColor, 0.9)]; // rgba(primary,.1) over the panel
  return [t.backgroundColor];
}

/** The header's full-strength ink: on-primary on a brand-colour header, the text colour otherwise. */
function headerInk(t) {
  return t.headerStyle === 'solid' || t.headerStyle === 'gradient' ? t.onPrimaryColor : t.textColor;
}

/** The muted header colour: as faded as possible while every header surface keeps 4.5:1. */
function mutedHeaderColor(t) {
  const surfaces = headerSurfaces(t);
  const ink = headerInk(t);
  const passes = (c) => surfaces.every((s) => contrast(c, s) >= MUTED_MIN_CONTRAST);
  // The old look was 25–40% of the way to the header; fade no further than that.
  for (let f = 0.4; f > 0.001; f -= 0.02) {
    const candidate = mix(ink, surfaces[0], f);
    if (passes(candidate)) return candidate;
  }
  if (passes(ink)) return ink;
  // Not even the ink clears every surface (finish() guarantees it does for
  // generated themes; this is a malformed stored one): the better of white
  // and dark ink on the worst surface.
  const worst = (c) => Math.min(...surfaces.map((s) => contrast(c, s)));
  return worst(WHITE) >= worst(DARK_TEXT) ? WHITE : DARK_TEXT;
}

/**
 * One theme object made safe for CSS, or null when it has no valid id.
 * Unknown or malformed values fall back to safe defaults rather than failing.
 * headerMutedColor is always DERIVED here (never trusted from storage), so
 * themes stored before it existed get a compliant one on read.
 */
function sanitizeTheme(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !THEME_ID_RE.test(t.id)) return null;
  const theme = sanitizeThemeFields(t);
  return { ...theme, headerMutedColor: mutedHeaderColor(theme) };
}

function sanitizeThemeFields(t) {
  const color = (v, fallback) => normalizeHex(v) || fallback;
  const primary = color(t.primaryColor, DEFAULT_PRIMARY);
  const radius = Number.parseInt(t.borderRadius, 10);
  return {
    id: t.id,
    themeName: cleanText(t.themeName, 40) || 'Custom design',
    description: cleanText(t.description, 160),
    primaryColor: primary,
    onPrimaryColor: color(t.onPrimaryColor, onColor(primary)),
    secondaryColor: color(t.secondaryColor, primary),
    accentColor: color(t.accentColor, primary),
    backgroundColor: color(t.backgroundColor, WHITE),
    textColor: color(t.textColor, DARK_TEXT),
    botBubbleColor: color(t.botBubbleColor, '#f1f5f9'),
    borderRadius: Number.isFinite(radius) ? clamp(radius, 0, MAX_RADIUS) : 12,
    headerStyle: HEADER_STYLES.includes(t.headerStyle) ? t.headerStyle : 'minimal',
    fontFamily: typeof t.fontFamily === 'string' && FONT_STACK_RE.test(t.fontFamily) ? t.fontFamily : FONT_STACKS.system,
    logoBadge: sanitizeLogoBadge(t.logoBadge)
  };
}

// Final readability pass shared by every design: button text, body text and
// bubble text all clear 4.5:1.
function finish(theme) {
  const onPrimaryColor = onColor(theme.primaryColor);
  const primaryColor = contrast(onPrimaryColor, theme.primaryColor) >= 4.5
    ? theme.primaryColor
    : ensureContrast(theme.primaryColor, onPrimaryColor, 4.5);
  const textColor = ensureContrast(ensureContrast(theme.textColor, theme.backgroundColor, 4.5), theme.botBubbleColor, 4.5);
  return sanitizeTheme({ ...theme, primaryColor, onPrimaryColor: onColor(primaryColor), textColor });
}

/**
 * Three distinct widget designs from a brand kit. Ids are stable
 * (minimal | vibrant | corporate), so a chosen design survives a rescan.
 * Every input is optional: with no brand colour the designs are built from a
 * neutral default, so a site we couldn't read still gets three good options.
 * @param {{ primaryColor?: string, secondaryColor?: string, accentColor?: string, fontHints?: string[] }} brand
 * @returns {object[]} three sanitized themes
 */
function generateThemes(brand = {}) {
  const base = normalizeHex(brand.primaryColor) || DEFAULT_PRIMARY;
  const baseHsl = hexToHsl(base);
  // A grey or black brand colour has no hue to build a vivid variant from.
  const hueSource = baseHsl.s < 0.12 ? hexToHsl(DEFAULT_PRIMARY) : baseHsl;
  const secondary = normalizeHex(brand.secondaryColor) || hslToHex({ h: hueSource.h + 30, s: 0.55, l: 0.5 });
  const accent = normalizeHex(brand.accentColor) || hslToHex({ h: hueSource.h + 150, s: 0.7, l: 0.5 });
  const brandFont = sanitizeFontName(brand.fontHints?.[0]);
  // The site's own font first: the widget runs on that site, so its web font
  // is usually already loaded there.
  const font = (stack) => (brandFont ? `'${brandFont}', ${stack}` : stack);

  // 1 · Modern Minimalist — white canvas, a translucent brand-tinted header,
  // soft rounded bubbles. The brand colour stays as close to the original as
  // white button text allows.
  const minimalPrimary = ensureContrast(base, WHITE, 4.5);
  const minimal = finish({
    id: 'minimal',
    themeName: 'Modern Minimalist',
    description: 'A clean white canvas, a soft brand-tinted header and gently rounded bubbles.',
    primaryColor: minimalPrimary,
    secondaryColor: secondary,
    accentColor: accent,
    backgroundColor: WHITE,
    textColor: DARK_TEXT,
    botBubbleColor: mix(minimalPrimary, WHITE, 0.92),
    borderRadius: 18,
    headerStyle: 'glass',
    fontFamily: font(FONT_STACKS.modern)
  });

  // 2 · Vibrant & Bold — the brand colour at full saturation, a brand-to-accent
  // gradient header, a lightly tinted canvas with white bubbles, pill corners.
  const vividPrimary = hslToHex({ h: hueSource.h, s: Math.max(hueSource.s, 0.7), l: clamp(hueSource.l, 0.42, 0.55) });
  const accentHsl = hexToHsl(accent);
  const vividOn = onColor(vividPrimary);
  // Header text sits on both ends of the gradient, so the accent must carry it too.
  const vividAccent = ensureContrast(
    hslToHex({ h: accentHsl.h, s: Math.max(accentHsl.s, 0.7), l: clamp(accentHsl.l, 0.42, 0.58) }), vividOn, 4.5
  );
  const vibrant = finish({
    id: 'vibrant',
    themeName: 'Vibrant & Bold',
    description: 'Full-strength brand colour, a gradient header and playful pill-shaped bubbles.',
    primaryColor: vividPrimary,
    secondaryColor: secondary,
    accentColor: vividAccent,
    backgroundColor: mix(vividPrimary, WHITE, 0.95),
    textColor: '#111827',
    botBubbleColor: WHITE,
    borderRadius: 24,
    headerStyle: 'gradient',
    fontFamily: font(FONT_STACKS.rounded)
  });

  // 3 · Corporate Professional — a deep, restrained version of the brand
  // colour, a solid header, a cool grey canvas and crisp, nearly square corners.
  const deepPrimary = ensureContrast(hslToHex({ h: baseHsl.h, s: Math.min(baseHsl.s, 0.6), l: Math.min(baseHsl.l, 0.3) }), WHITE, 7);
  const corporate = finish({
    id: 'corporate',
    themeName: 'Corporate Professional',
    description: 'A deep, restrained palette, a solid header and crisp, squared-off bubbles.',
    primaryColor: deepPrimary,
    secondaryColor: secondary,
    accentColor: ensureContrast(base, WHITE, 3),
    backgroundColor: '#f8fafc',
    textColor: DARK_TEXT,
    botBubbleColor: mix(deepPrimary, WHITE, 0.9),
    borderRadius: 6,
    headerStyle: 'solid',
    fontFamily: font(FONT_STACKS.corporate)
  });

  // Each design seats the logo for its own header colour.
  const appearance = sanitizeLogoAppearance(brand.logoAppearance);
  return [minimal, vibrant, corporate].map((t) => sanitizeTheme({ ...t, logoBadge: logoBadgeFor(t, appearance) }));
}

module.exports = {
  generateThemes,
  sanitizeTheme,
  sanitizeBrand,
  sanitizeLogoAppearance,
  logoBadgeFor,
  mutedHeaderColor,
  headerSurfaces,
  MUTED_MIN_CONTRAST,
  sanitizeFontName,
  safeUrl,
  onColor,
  ensureContrast,
  DEFAULT_PRIMARY,
  FONT_STACKS,
  HEADER_STYLES
};
