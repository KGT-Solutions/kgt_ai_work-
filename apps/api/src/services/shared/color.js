// Colour maths shared by the brand extractor (brandExtractor.js) and the
// widget theme generator (themeGenerator.js). Hex values are always the
// lower-case six-digit form '#rrggbb'; HSL is { h: 0-360, s: 0-1, l: 0-1 }.

const HEX6_RE = /^#[0-9a-f]{6}$/;

/** '#abc' / '#aabbcc' (any case) → '#aabbcc', else null. Strict: nothing else is accepted. */
function normalizeHex(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return HEX6_RE.test(s) ? s : null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function hexToHsl(hex) {
  let { r, g, b } = hexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  if (sat === 0) return rgbToHex({ r: lig * 255, g: lig * 255, b: lig * 255 });
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex({ r: channel(hue + 1 / 3) * 255, g: channel(hue) * 255, b: channel(hue - 1 / 3) * 255 });
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `a` blended toward `b`; t = 0 gives a, t = 1 gives b. */
function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** Shortest distance between two hues on the colour wheel, 0-180 degrees. */
function hueDistance(a, b) {
  const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h) % 360;
  return d > 180 ? 360 - d : d;
}

/** Euclidean distance in RGB space, 0 to ~441. */
function rgbDistance(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
}

module.exports = {
  normalizeHex, hexToRgb, rgbToHex, hexToHsl, hslToHex, luminance, contrast, mix, hueDistance, rgbDistance
};
