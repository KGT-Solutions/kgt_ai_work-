const { normalizeHex, hexToHsl, hueDistance, rgbDistance } = require('./color');

// Brand identity from a company's homepage — its logo and a small colour
// palette — for the Bot Branding & Theme Studio (services/branding.js).
//
// Pure on purpose: it reads HTML/CSS it is handed and never fetches anything.
// crawler.js does the fetching (homepage and up to MAX_STYLESHEETS linked
// stylesheets) through the same SSRF guards as every crawl, and passes in its
// cheerio root — cheerio is loaded there, after the Node 18 `File` polyfill.
//
// Logo, strongest signal first:
//   1. an <img> whose alt / class / id / src says "logo" (or whose wrapping
//      link says logo, or "brand" inside the header) — inside the header or
//      nav scores above anywhere else, earlier on the page above later;
//   2. og:logo, then the apple-touch-icon (square and high-resolution);
//   3. og:image — often a social banner rather than the mark, so lower;
//   4. the largest <link rel="icon">.
// Colours: the theme-color meta (an explicit statement of the brand colour),
// CSS custom properties named like one (--primary, --brand-color, --accent…),
// then backgrounds, then text and border colours — weighted by where they
// appear. Greys, near-whites and near-blacks are dropped: every site uses
// them, so they say nothing about the brand.

const MAX_URL_LENGTH = 2048;
const MAX_CSS_CHARS = 600 * 1024;
const MAX_STYLESHEETS = 3;
const MAX_COLORS = 6;

// Framework, font and icon CSS: a framework's default palette (Bootstrap's
// #0d6efd, say) would outvote the brand, and font CSS carries no colours.
const SKIP_STYLESHEET_RE =
  /bootstrap|font-?awesome|fonts\.googleapis|gstatic|jquery|animate(\.min)?\.css|normalize|swiper|slick|owl\.carousel|icomoon|dashicons|wp-block-library/i;

// Every regex below runs on CSS from arbitrary websites, so each must stay
// linear on hostile input. The colour separators are `(?:\s*,\s*|\s+)` rather
// than `\s*[,\s]\s*` — three overlapping whitespace runs backtracked
// quadratically on "rgb(1" followed by a long run of spaces (ReDoS).
const COLOR_TOKEN_RE = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\(\s*\d{1,3}(?:\s*,\s*|\s+)\d{1,3}(?:\s*,\s*|\s+)\d{1,3}\s*(?:[,/]\s*[\d.]+%?\s*)?\)/gi;
// No real colour or font declaration comes close to this; longer values are
// skipped outright, which also bounds the work any one value can cost.
const MAX_DECLARATION_CHARS = 4096;
// Outside the header, more "logo" images than this is a client/partner wall.
const MAX_BODY_LOGOS = 2;

// Font names that say nothing about the brand: CSS keywords, system-font
// aliases and emoji fonts. Icon fonts are filtered by ICON_FONT_RE.
const GENERIC_FONTS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset', 'revert',
  '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'emoji', 'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji'
]);
const ICON_FONT_RE = /icon|awesome|material|glyph|dashicons|icomoon|fontello|ionicons|feather|simple-line|slick/i;

/** An absolute http(s) URL for `href` against the page, or null (data:, javascript:, malformed, too long). */
function resolveUrl(href, pageUrl) {
  const raw = String(href || '').trim();
  if (!raw || /^(data|javascript|blob):/i.test(raw)) return null;
  try {
    const url = new URL(raw, pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const s = url.toString();
    return s.length <= MAX_URL_LENGTH ? s : null;
  } catch {
    return null;
  }
}

// No real colour value is longer than this ("rgba(255, 255, 255, 0.5)" is 25).
// normalizeColor also reads the page's theme-color meta — page-controlled and
// otherwise unbounded — so anything longer is refused before any regex runs.
const MAX_COLOR_CHARS = 64;
// The same linear separators as COLOR_TOKEN_RE. The previous `\s*[,\s]\s*`
// (three overlapping whitespace runs) was quadratic: a theme-color of
// "rgb(1" + 64,000 spaces took 3 s, and a 3 MB page ~110 min, on an
// unauthenticated route (POST /public/register/analyze).
const RGB_RE = /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/;

/** Any CSS colour token we read → '#rrggbb', or null (also null when mostly transparent, or too long to be a colour). */
function normalizeColor(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s || s.length > MAX_COLOR_CHARS) return null;
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(s);
  if (hex8) return parseInt(hex8[2], 16) < 128 ? null : `#${hex8[1]}`;
  const hex = normalizeHex(s);
  if (hex) return hex;
  const rgb = RGB_RE.exec(s);
  if (!rgb) return null;
  if (rgb[4] !== undefined) {
    const alpha = Number(rgb[4]) / (rgb[5] ? 100 : 1);
    if (!(alpha >= 0.5)) return null;
  }
  const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
  if (channels.some((c) => c > 255)) return null;
  return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** A colour that can stand for a brand: saturated enough, and neither near-white nor near-black. */
function isBrandish(hex) {
  const { s, l } = hexToHsl(hex);
  return s >= 0.2 && l >= 0.1 && l <= 0.92;
}

function firstSrcsetUrl(srcset) {
  return String(srcset || '').trim().split(/\s+/)[0] || '';
}

// The image's real address. Lazy-loading sites put a data: placeholder in src
// and the real file in data-src / srcset, so a data: value is passed over
// rather than ending the search.
function firstUsableSrc($el) {
  const candidates = [
    $el.attr('src'), $el.attr('data-src'), $el.attr('data-lazy-src'), $el.attr('data-original'),
    firstSrcsetUrl($el.attr('srcset')), firstSrcsetUrl($el.attr('data-srcset'))
  ];
  for (const value of candidates) {
    const v = String(value || '').trim();
    if (v && !/^data:/i.test(v)) return v;
  }
  return null;
}

function sameSite(url, pageUrl) {
  try {
    const key = (u) => new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    return key(url) === key(pageUrl);
  } catch {
    return false;
  }
}

/**
 * Everything the homepage itself says about the brand. Must run on the page
 * BEFORE crawler.js strips the header/nav, which is where the logo lives.
 * @param {import('cheerio').CheerioAPI} $ the page's cheerio root
 * @param {string} pageUrl the page's final URL, for resolving relative links
 */
function extractBrandSignals($, pageUrl) {
  const logos = [];
  const add = (href, source, score) => {
    const url = resolveUrl(href, pageUrl);
    if (url) logos.push({ url, source, score });
  };

  const bodyLogos = []; // "logo" images outside the header, in page order
  $('img').each((index, el) => {
    const $el = $(el);
    // A footer's logos are payment badges, certifications and partners.
    if ($el.closest('footer, [role="contentinfo"]').length) return;
    const own = ['alt', 'class', 'id', 'src', 'data-src', 'title'].map((a) => $el.attr(a) || '').join(' ').toLowerCase();
    const $wrap = $el.closest('a, div, span, figure').first();
    const wrap = ['class', 'id', 'aria-label'].map((a) => $wrap.attr(a) || '').join(' ').toLowerCase();
    const inHeader = $el.closest('header, nav, [role="banner"], .header, #header, .navbar, .site-header').length > 0;
    // "brand" alone is trusted only in the header: further down the page it is
    // as likely a "brands we carry" carousel as the company's own mark.
    const saysLogo = own.includes('logo') || wrap.includes('logo') || (inHeader && wrap.includes('brand'));
    if (!saysLogo) return;
    const src = firstUsableSrc($el);
    if (!src) return;
    if (inHeader) add(src, 'img', 100 - Math.min(index, 10));
    else bodyLogos.push(src);
  });
  // Outside the header, one or two "logo" images can be the company's own
  // mark; more than that is a client wall ("Trusted by …"), and none of those
  // is ours — a site with an inline-SVG logo otherwise showed a partner's
  // logo in its own widget. Scored below og:logo and the touch icon, above og:image.
  if (bodyLogos.length <= MAX_BODY_LOGOS) bodyLogos.forEach((src, i) => add(src, 'img', 50 - i));
  $('meta[property="og:logo"]').each((_, el) => add($(el).attr('content'), 'og:logo', 70));
  $('link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((_, el) => add($(el).attr('href'), 'apple-touch-icon', 60));
  $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => add($(el).attr('content'), 'og:image', 40));

  let faviconUrl = null;
  let faviconScore = -1;
  $('link[rel~="icon"]').each((_, el) => {
    const href = $(el).attr('href');
    const size = parseInt(String($(el).attr('sizes') || '').split('x')[0], 10) || 0;
    const score = 20 + Math.min(size, 256) / 32 + (/\.svg(\?|$)/i.test(href || '') ? 4 : 0);
    add(href, 'icon', score);
    const url = resolveUrl(href, pageUrl);
    if (url && score > faviconScore) { faviconUrl = url; faviconScore = score; }
  });
  if (!faviconUrl) faviconUrl = resolveUrl('/favicon.ico', pageUrl);

  logos.sort((a, b) => b.score - a.score);

  const themeColor = normalizeColor($('meta[name="theme-color"]').first().attr('content'))
    || normalizeColor($('meta[name="msapplication-TileColor"]').first().attr('content'));

  const cssTexts = [];
  let budget = MAX_CSS_CHARS;
  $('style').each((_, el) => {
    if (budget <= 0) return;
    const text = String($(el).html() || '').slice(0, budget);
    budget -= text.length;
    cssTexts.push(text);
  });
  const inline = [];
  $('[style]').each((_, el) => { inline.push($(el).attr('style')); });
  if (inline.length) cssTexts.push(inline.join(';').slice(0, Math.max(0, budget)));

  const stylesheetUrls = [];
  $('link[rel~="stylesheet"][href]').each((_, el) => {
    const url = resolveUrl($(el).attr('href'), pageUrl);
    if (url && !SKIP_STYLESHEET_RE.test(url) && !stylesheetUrls.includes(url)) stylesheetUrls.push(url);
  });
  // A site's own stylesheet carries its brand far more often than a third party's.
  stylesheetUrls.sort((a, b) => Number(sameSite(b, pageUrl)) - Number(sameSite(a, pageUrl)));

  const siteName = String(
    $('meta[property="og:site_name"]').first().attr('content') || $('meta[name="application-name"]').first().attr('content') || ''
  ).replace(/[<>]/g, '').trim().slice(0, 120) || null;

  return {
    logos,
    logoUrl: logos[0]?.url || null,
    faviconUrl,
    themeColor,
    cssTexts,
    stylesheetUrls: stylesheetUrls.slice(0, MAX_STYLESHEETS),
    siteName
  };
}

// ---------------------------------------------------------------------
// CSS → weighted colours and font hints.
// ---------------------------------------------------------------------

/**
 * CSS with its comments replaced by a space, in one linear pass. The regex
 * this replaces (\/\*[\s\S]*?\*\/) rescanned to the end of the input from
 * every unclosed "/*", which is quadratic on hostile CSS. An unclosed comment
 * runs to the end, as in a browser.
 */
function stripComments(css) {
  const text = String(css || '');
  let out = '';
  let i = 0;
  for (;;) {
    const start = text.indexOf('/*', i);
    if (start === -1) return out + text.slice(i);
    out += text.slice(i, start) + ' ';
    const end = text.indexOf('*/', start + 2);
    if (end === -1) return out;
    i = end + 2;
  }
}

// Every "prop: value" between ; { } boundaries, comments removed. Not a CSS
// parser and doesn't need to be: a selector like "a:hover" yields a harmless
// "a: hover" pair with no colour in it. A match may only start where a word
// starts (the lookbehind) and a property name is at most 64 characters, so a
// long run of word characters with no colon costs linear time — the previous
// ([-\w]+)\s*: retried from every position in the run (quadratic, ReDoS).
function* declarations(css) {
  const text = stripComments(css);
  const re = /(?<![-\w])([-\w]{1,64})\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = re.exec(text))) yield [m[1].toLowerCase(), m[2]];
}

function propertyWeight(prop) {
  if (prop.startsWith('--')) return /primary|brand|accent|main|theme|secondary|highlight|cta/.test(prop) ? 6 : 1;
  if (prop === 'background' || prop === 'background-color' || prop === 'background-image') return 3;
  if (prop === 'color') return 1.5;
  if (/^(border|outline|fill|stroke|text-decoration-color|caret-color|accent-color)/.test(prop)) return 1;
  if (prop.includes('shadow')) return 0.3;
  return 0.5;
}

// The role a custom property's name claims. Checked in this order so
// "--theme-secondary" is a secondary, not a primary.
function roleOf(prop) {
  if (!prop.startsWith('--')) return null;
  if (prop.includes('secondary')) return 'secondary';
  if (/accent|highlight/.test(prop)) return 'accent';
  if (/primary|brand|main|theme|cta/.test(prop)) return 'primary';
  return null;
}

function fontFamilyHint(value) {
  for (const part of String(value).split(',')) {
    const name = part.trim().replace(/^["']|["']$/g, '').trim();
    if (!name || name.startsWith('var(')) continue;
    if (GENERIC_FONTS.has(name.toLowerCase()) || ICON_FONT_RE.test(name)) continue;
    if (!/^[\w \-]{1,40}$/.test(name)) continue;
    return name;
  }
  return null;
}

const bump = (map, key, w) => map.set(key, (map.get(key) || 0) + w);
const ranked = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

/**
 * @param {string[]} cssTexts
 * @returns {{ ranked: string[], roles: { primary: string[], secondary: string[], accent: string[] }, fonts: string[] }}
 *   ranked: brand-ish colours, strongest first, near-duplicates merged into
 *   the stronger shade.
 */
function harvestColors(cssTexts) {
  const weights = new Map();
  const roles = { primary: new Map(), secondary: new Map(), accent: new Map() };
  const fonts = new Map();

  for (const css of cssTexts) {
    for (const [prop, value] of declarations(css)) {
      if (value.length > MAX_DECLARATION_CHARS) continue;
      if (prop === 'font-family') {
        const font = fontFamilyHint(value);
        if (font) bump(fonts, font, 1);
        continue;
      }
      const weight = propertyWeight(prop);
      const role = roleOf(prop);
      for (const token of value.match(COLOR_TOKEN_RE) || []) {
        const hex = normalizeColor(token);
        if (!hex || !isBrandish(hex)) continue;
        bump(weights, hex, weight);
        if (role) bump(roles[role], hex, weight);
      }
    }
  }

  // Merge near-identical shades (#1a73e8 vs #1a72e9) into the heavier one.
  const clusters = [];
  for (const [hex, weight] of [...weights.entries()].sort((a, b) => b[1] - a[1])) {
    const near = clusters.find((c) => rgbDistance(c.hex, hex) < 28);
    if (near) near.weight += weight;
    else clusters.push({ hex, weight });
  }
  clusters.sort((a, b) => b.weight - a.weight);

  return {
    ranked: clusters.map((c) => c.hex),
    roles: { primary: ranked(roles.primary), secondary: ranked(roles.secondary), accent: ranked(roles.accent) },
    fonts: ranked(fonts)
  };
}

// Distinct enough to read as a different brand colour, not another shade of the same one.
function distinct(hex, others) {
  return others.every((o) => !o || (hueDistance(hex, o) >= 25 || Math.abs(hexToHsl(hex).l - hexToHsl(o).l) >= 0.25));
}

/**
 * @returns {{ primaryColor: string|null, secondaryColor: string|null, accentColor: string|null, colors: string[] }}
 */
function pickPalette({ ranked: colors, roles, themeColor }) {
  // theme-color is a deliberate statement of the brand colour, so it wins even
  // when it's dark or muted — only an unusable near-white is ignored.
  const themeUsable = themeColor && hexToHsl(themeColor).l <= 0.95;
  const primary = (themeUsable && themeColor) || roles.primary[0] || colors[0] || null;
  const secondary = primary
    ? [...roles.secondary, ...colors].find((c) => c !== primary && distinct(c, [primary])) || null
    : null;
  const accent = primary
    ? [...roles.accent, ...colors].find((c) => c !== primary && c !== secondary && distinct(c, [primary, secondary])) || null
    : null;
  const palette = [...new Set([primary, secondary, accent, ...colors].filter(Boolean))].slice(0, MAX_COLORS);
  return { primaryColor: primary, secondaryColor: secondary, accentColor: accent, colors: palette };
}

/**
 * The brand kit, from the homepage's signals plus any stylesheet text fetched for it.
 * @param {ReturnType<typeof extractBrandSignals>} signals
 * @param {string[]} [extraCss] linked stylesheet bodies
 */
function resolveBrand(signals, extraCss = []) {
  const harvest = harvestColors([...(signals.cssTexts || []), ...extraCss]);
  const palette = pickPalette({ ranked: harvest.ranked, roles: harvest.roles, themeColor: signals.themeColor });
  return {
    logoUrl: signals.logoUrl || null,
    faviconUrl: signals.faviconUrl || null,
    siteName: signals.siteName || null,
    ...palette,
    fontHints: harvest.fonts.slice(0, 2)
  };
}

module.exports = {
  extractBrandSignals,
  resolveBrand,
  harvestColors,
  stripComments,
  COLOR_TOKEN_RE,
  MAX_DECLARATION_CHARS,
  pickPalette,
  normalizeColor,
  MAX_COLOR_CHARS,
  isBrandish,
  resolveUrl,
  SKIP_STYLESHEET_RE,
  MAX_STYLESHEETS
};
