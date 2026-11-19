const { rgbToHex, luminance } = require('./color');

let sharpLib = null;
try { sharpLib = require('sharp'); } catch { sharpLib = null; } // optional: without it, logos are just "unknown"

// What a logo image looks like, so the widget can seat it cleanly on any
// header colour (themeGenerator.js logoBadgeFor). Two questions:
//
//   background — is there a box behind the mark? Read from the image's outer
//     edge: mostly see-through ⇒ 'transparent'; one solid colour ⇒ 'light' /
//     'dark' / 'color' with that colour; anything else (a photo, a gradient) ⇒
//     'complex' with its average edge colour.
//   tone — is the mark itself light (a white logo made for dark headers) or
//     dark? The mean luminance of its "ink": opaque pixels that differ from
//     the background.
//   monochrome — is the ink a single neutral colour (a black wordmark, a white
//     one)? Such a mark can be recoloured to the header's text colour without
//     losing anything; a multicolour mark can't.
//
// The image is shrunk to 64px first, so this is cheap. It never throws: an
// unreadable image (a .ico favicon, a truncated download) or a missing sharp
// gives null, and the widget falls back to its safe default badge.

const ANALYZE_SIZE = 64;
const MAX_INPUT_PIXELS = 25 * 1000 * 1000; // logoUpload.js MAX_INPUT_PIXELS
const CLEAR_ALPHA = 40;          // below this a pixel counts as see-through
const OPAQUE_ALPHA = 200;
const SAME_COLOR_DISTANCE = 40;  // RGB distance within which edge pixels are "the same colour"
const INK_DISTANCE = 60;         // how far from the background a pixel must be to count as the mark
const CHROMA_DISTANCE = 48;      // max−min channel spread above which an ink pixel is "coloured"
const MAX_COLORFUL_SHARE = 0.06; // a mark with fewer coloured pixels than this is monochrome

const distance = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const toHex = (p) => rgbToHex({ r: p[0], g: p[1], b: p[2] });

function meanColor(pixels) {
  const sum = [0, 0, 0];
  for (const p of pixels) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
  return sum.map((v) => v / Math.max(1, pixels.length));
}

/**
 * @param {Buffer} buffer the image file's bytes (PNG, JPEG, WebP, GIF, SVG…)
 * @param {{ sharp?: Function }} [deps]
 * @returns {Promise<{ background: 'transparent'|'light'|'dark'|'color'|'complex',
 *   backgroundColor: string|null, tone: 'light'|'dark', monochrome: boolean } | null>}
 */
async function analyzeLogo(buffer, { sharp = sharpLib } = {}) {
  if (!sharp || !Buffer.isBuffer(buffer) || !buffer.length) return null;
  try {
    // limitInputPixels: a logo from someone's website (scan, paste, signup) can
    // be a pixel bomb — a 758 KB PNG declaring 16000×16000 cost ~0.5 s of CPU
    // per fetch. Past 25 MP sharp refuses to decode; the logo is then
    // "unanalysed" (null), as for any unreadable image. Same cap as uploads.
    const { data, info } = await sharp(buffer, { failOn: 'none', animated: false, limitInputPixels: MAX_INPUT_PIXELS })
      .resize(ANALYZE_SIZE, ANALYZE_SIZE, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = info;
    if (!w || !h) return null;
    const pixel = (x, y) => {
      const i = (y * w + x) * channels;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };

    // The outer one-pixel frame.
    const edge = [];
    for (let x = 0; x < w; x++) edge.push(pixel(x, 0), pixel(x, h - 1));
    for (let y = 1; y < h - 1; y++) edge.push(pixel(0, y), pixel(w - 1, y));

    let background;
    let bg = null;
    const clearShare = edge.filter((p) => p[3] < CLEAR_ALPHA).length / edge.length;
    if (clearShare >= 0.6) {
      background = 'transparent';
    } else {
      const opaque = edge.filter((p) => p[3] >= OPAQUE_ALPHA);
      bg = meanColor(opaque.length ? opaque : edge);
      const sameShare = opaque.filter((p) => distance(p, bg) < SAME_COLOR_DISTANCE).length / edge.length;
      if (opaque.length / edge.length >= 0.8 && sameShare >= 0.75) {
        const lum = luminance(toHex(bg));
        background = lum > 0.8 ? 'light' : lum < 0.08 ? 'dark' : 'color';
      } else {
        background = 'complex';
      }
    }

    // The mark's own tone, from the pixels that make it up.
    let inkLum = 0;
    let inkCount = 0;
    let colorful = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = pixel(x, y);
        if (p[3] < 128) continue;
        if (bg && distance(p, bg) <= INK_DISTANCE) continue;
        inkLum += luminance(toHex(p));
        inkCount += 1;
        if (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) > CHROMA_DISTANCE) colorful += 1;
      }
    }
    const tone = inkCount
      ? (inkLum / inkCount > 0.6 ? 'light' : 'dark')
      : (bg && luminance(toHex(bg)) > 0.5 ? 'dark' : 'light');
    const monochrome = inkCount > 0 && colorful / inkCount < MAX_COLORFUL_SHARE;

    return { background, backgroundColor: bg ? toHex(bg) : null, tone, monochrome };
  } catch {
    return null;
  }
}

module.exports = { analyzeLogo, isLogoAnalysisAvailable: () => !!sharpLib, MAX_INPUT_PIXELS };
