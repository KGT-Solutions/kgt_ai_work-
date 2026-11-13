const crypto = require('crypto');

let sharpLib = null;
try { sharpLib = require('sharp'); } catch { sharpLib = null; }

// Client logo uploads (Theme Studio). The uploaded bytes are never stored or
// served: the file must really be a PNG, JPEG or WebP (by its first bytes, not
// its name or declared type — so no SVG, HTML or polyglot slips through), and
// what is kept is sharp's re-encoding of the decoded pixels — a PNG at most
// MAX_LOGO_EDGE px on its longest side, with every metadata block (EXIF, GPS,
// ICC text, comments) dropped and transparency kept.

const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_EDGE = 512;
const MIN_LOGO_EDGE = 16;
// A 2 MB file can still declare 30000×30000 pixels; sharp refuses to decode
// past this, so a decompression bomb costs nothing.
const MAX_INPUT_PIXELS = 25 * 1000 * 1000;
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// The version of prepareLogo's output. A stored logo made by an older version
// is run through the pipeline again on the next save or rescan (branding.js).
const LOGO_PIPELINE_VERSION = 4; // 4: every solid background removed, not only white
const UPLOAD_FORMATS = ['png', 'jpeg', 'webp'];
const LINKED_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'svg', 'avif'];

class LogoUploadError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'LogoUploadError';
    this.statusCode = statusCode;
  }
}

/** The image type a buffer's first bytes prove, or null. */
function sniffImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Validate and re-encode an uploaded logo.
 * @returns {Promise<{ data: Buffer, key: string, width: number, height: number, mimeType: 'image/png' }>}
 * @throws {LogoUploadError} 400 not a usable image · 413 too large · 503 no image library
 */
async function processLogoUpload(buffer, { sharp = sharpLib, linked = false } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new LogoUploadError('Choose an image file to upload.');
  if (buffer.length > MAX_LOGO_UPLOAD_BYTES) throw new LogoUploadError(`Logos are limited to ${MAX_LOGO_UPLOAD_BYTES / (1024 * 1024)}MB.`, 413);
  // A logo downloaded from the tenant's website may be any web image format
  // (SVG and GIF included); it is rasterised to PNG all the same.
  if (!linked && !sniffImageType(buffer)) throw new LogoUploadError('The logo must be a PNG, JPEG or WebP image.');
  if (!sharp) throw new LogoUploadError('Logo uploads aren’t available on this server right now. Paste a logo URL instead.', 503);

  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false }).metadata();
  } catch (err) {
    if (/pixel limit/i.test(err.message)) throw new LogoUploadError('That image has too many pixels. Use a logo under 5000×5000.', 413);
    throw new LogoUploadError('That image couldn’t be read — it may be damaged. Try exporting it again as PNG.');
  }
  if (!(linked ? LINKED_FORMATS : UPLOAD_FORMATS).includes(meta.format)) throw new LogoUploadError('The logo must be a PNG, JPEG or WebP image.');
  // EXIF orientations 5-8 swap width and height.
  const [w, h] = meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (!w || !h || w < MIN_LOGO_EDGE || h < MIN_LOGO_EDGE) {
    throw new LogoUploadError(`The logo is too small — use an image at least ${MIN_LOGO_EDGE}×${MIN_LOGO_EDGE} pixels.`);
  }

  let out;
  try {
    out = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
      .rotate() // apply the EXIF orientation before the metadata goes
      .resize({ width: MAX_LOGO_EDGE, height: MAX_LOGO_EDGE, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new LogoUploadError('That image couldn’t be read — it may be damaged. Try exporting it again as PNG.');
  }
  return {
    data: out.data,
    key: crypto.createHash('sha256').update(out.data).digest('hex').slice(0, 24),
    width: out.info.width,
    height: out.info.height,
    mimeType: 'image/png'
  };
}

// ── Background knockout. Most logos are exported as artwork on a white (or
// off-white) rectangle. On a coloured or gradient chat header that rectangle
// is a pasted-on box, and no CSS can remove it there: mix-blend-mode multiply
// only works over a light backdrop and darkens the artwork on any other. So
// the box is removed from the pixels once, here, with "colour to alpha" (the
// GIMP/Photoshop technique): each pixel becomes the most transparent colour
// that, laid over the background colour, reproduces it. The box vanishes,
// anti-aliased edges become soft alpha instead of a white fringe, and the
// counters inside letters (the hole in an "o") go too, which an edge flood
// fill would miss. Only a near-white box is removed: a coloured or dark tile
// is usually part of the design (an app-icon logo) and is kept.

const KNOCKOUT_TOLERANCE = 0.12; // JPEG noise within 12% of the background counts as background
const MIN_INK_SHARE = 0.003;     // less artwork than this left ⇒ the "logo" was the box; don't knock out
// Textbook colour-to-alpha explains a near-black #111827 as 92%-opaque black,
// so solid lettering turns faintly see-through. Instead, alpha is measured
// against the logo's own ink strength (a high percentile of how far its
// pixels are from the box): solid artwork stays fully opaque in its true
// colour, and only real edge pixels — partly covered by the ink — get partial
// alpha, un-mixed back to the ink colour.
const INK_PERCENTILE = 0.9;
const MIN_HEADROOM = 96;
const MIN_INK_STRENGTH = 0.35;

const ARTWORK_CHROMA = 40;    // a boundary pixel more colourful than this is "a coloured shape"
const ARTWORK_SHARE = 0.5;    // an enclosed region kept when at least this share of its border is coloured…
const ARTWORK_THICKNESS = 0.1; // …and the ink around it is at least this fraction of the logo's height thick
const SEAM_RADIUS = 2;        // px around a kept region also kept, so no header shows through its anti-aliased edge

/**
 * Which pixels to leave untouched: white artwork inside a coloured shape (the
 * white initial in a blue emblem) and its anti-aliased seam. Such a region is
 * box-coloured, NOT connected to the image edge, bordered mainly by colour,
 * and wrapped in THICK ink — an emblem's fill. The counter of a letter (the
 * hole in an "o", even in a coloured wordmark) is wrapped in a thin stroke:
 * it's a hole, and still goes.
 * @returns {Uint8Array} 1 = keep as drawn
 */
function enclosedArtwork(data, dist, w, h) {
  const n = w * h;
  const isBox = (j) => dist[j] <= KNOCKOUT_TOLERANCE;
  const region = new Int32Array(n).fill(-1); // -2: the outside box; ≥0: an enclosed region's id
  const queue = new Int32Array(n);
  const flood = (start, id) => {
    let head = 0; let tail = 0;
    queue[tail++] = start; region[start] = id;
    const members = [];
    while (head < tail) {
      const j = queue[head++];
      members.push(j);
      const x = j % w; const y = (j - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (region[k] === -1 && isBox(k)) { region[k] = id; queue[tail++] = k; }
      }
    }
    return members;
  };
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (region[y * w + x] === -1 && isBox(y * w + x)) flood(y * w + x, -2);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (region[y * w + x] === -1 && isBox(y * w + x)) flood(y * w + x, -2);

  const keep = new Uint8Array(n);
  let id = 0;
  for (let j = 0; j < n; j++) {
    if (region[j] !== -1 || !isBox(j)) continue;
    const members = flood(j, id++);
    let border = 0; let colourful = 0;
    for (const m of members) {
      const x = m % w; const y = (m - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (isBox(k)) continue;
        border += 1;
        const i = k * 4;
        if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > ARTWORK_CHROMA) colourful += 1;
      }
    }
    if (!border || colourful / border < ARTWORK_SHARE) continue;
    if (inkThickness(members, region, dist, w, h, queue) < Math.max(4, ARTWORK_THICKNESS * h)) continue;
    for (const m of members) {
      const x = m % w; const y = (m - x) / w;
      for (let dy = -SEAM_RADIUS; dy <= SEAM_RADIUS; dy++) {
        for (let dx = -SEAM_RADIUS; dx <= SEAM_RADIUS; dx++) {
          const nx = x + dx; const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && region[ny * w + nx] !== -2) keep[ny * w + nx] = 1;
        }
      }
    }
  }
  return keep;
}

// How thick the ink wrapped around an enclosed region is: the fewest steps
// through ink from the region to the outside box (a breadth-first search from
// all its pixels at once). Capped, since only "thick enough" matters.
function inkThickness(members, region, dist, w, h, queue) {
  const cap = Math.ceil(h / 2);
  const seen = new Map(); // pixel → steps
  let head = 0; let tail = 0;
  for (const m of members) { queue[tail++] = m; seen.set(m, 0); }
  while (head < tail) {
    const j = queue[head++];
    const steps = seen.get(j);
    if (steps >= cap) return cap;
    const x = j % w; const y = (j - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return steps; // ink reaching the image edge: as thin as it gets
      const k = ny * w + nx;
      if (region[k] === -2) return steps; // reached the outside box
      if (seen.has(k) || dist[k] <= KNOCKOUT_TOLERANCE) continue; // another hole: not a way out through ink
      seen.set(k, steps + 1);
      queue[tail++] = k;
    }
  }
  return cap;
}

const MIN_PLATE_SHARE = 0.03; // edge mode: less opaque plate than this touching the edge ⇒ no plate to remove
const PLATE_SEAM = 2;         // edge mode: px beyond the plate also cleaned, for its anti-aliased rim
// A coloured plate must be a block: plate + artwork fill this much of its
// bounding box (a rounded rectangle ≈ 0.9–0.99; a circle emblem is 0.785, a
// shape — kept), and that box must cover this much of the image.
const MIN_RECT_FILL = 0.85;
const MIN_RECT_COVER = 0.4;

/**
 * Edge mode's region: everything reachable from the image's border through
 * see-through or box-coloured pixels — a plate however it sits (edge to edge,
 * inside transparent margins, behind a soft shadow) — widened by its
 * anti-aliased rim. Box-coloured pixels the border can't reach (white artwork,
 * letter counters) are outside it and untouched. Null when there's no plate.
 * requireRect: the plate must be a rectangular block (MIN_RECT_FILL) — for a
 * coloured plate, which could otherwise be an emblem's own shape.
 */
function edgePlate(data, dist, w, h, { requireRect = false } = {}) {
  const n = w * h;
  const passable = (j) => data[j * 4 + 3] < 24 || dist[j] <= KNOCKOUT_TOLERANCE;
  const inRegion = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0; let tail = 0;
  const push = (j) => { if (!inRegion[j] && passable(j)) { inRegion[j] = 1; queue[tail++] = j; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  let plate = 0;
  while (head < tail) {
    const j = queue[head++];
    if (data[j * 4 + 3] >= 24) plate += 1;
    const x = j % w; const y = (j - x) / w;
    if (x > 0) push(j - 1);
    if (x < w - 1) push(j + 1);
    if (y > 0) push(j - w);
    if (y < h - 1) push(j + w);
  }
  if (plate / n < MIN_PLATE_SHARE) return null;
  // A backing plate surrounds the artwork: its bounding box must contain every
  // other opaque pixel. White lettering beside a coloured emblem doesn't — it's
  // artwork, not a plate, and is left alone.
  let pMinX = w, pMinY = h, pMaxX = -1, pMaxY = -1;
  let aMinX = w, aMinY = h, aMaxX = -1, aMaxY = -1;
  for (let j = 0; j < n; j++) {
    if (data[j * 4 + 3] < 24) continue;
    const x = j % w; const y = (j - x) / w;
    if (inRegion[j]) { pMinX = Math.min(pMinX, x); pMaxX = Math.max(pMaxX, x); pMinY = Math.min(pMinY, y); pMaxY = Math.max(pMaxY, y); }
    else { aMinX = Math.min(aMinX, x); aMaxX = Math.max(aMaxX, x); aMinY = Math.min(aMinY, y); aMaxY = Math.max(aMaxY, y); }
  }
  if (aMaxX < 0) return null; // nothing but the "plate": it was the logo
  if (aMinX < pMinX - 2 || aMaxX > pMaxX + 2 || aMinY < pMinY - 2 || aMaxY > pMaxY + 2) return null;
  if (requireRect) {
    const boxArea = (pMaxX - pMinX + 1) * (pMaxY - pMinY + 1);
    let filled = 0;
    for (let y = pMinY; y <= pMaxY; y++) for (let x = pMinX; x <= pMaxX; x++) if (data[(y * w + x) * 4 + 3] >= 24) filled += 1;
    if (filled / boxArea < MIN_RECT_FILL || boxArea / n < MIN_RECT_COVER) return null;
  }
  const mask = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    if (!inRegion[j]) continue;
    const x = j % w; const y = (j - x) / w;
    for (let dy = -PLATE_SEAM; dy <= PLATE_SEAM; dy++) {
      for (let dx = -PLATE_SEAM; dx <= PLATE_SEAM; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) mask[ny * w + nx] = 1;
      }
    }
  }
  return mask;
}

const RING_SAME = 40;       // RGB distance within which ring pixels count as one plate colour
const RING_UNIFORM = 0.7;  // share of the ring that must be that one colour

/**
 * The colour of a solid plate sitting inside a see-through margin — e.g. a
 * blue rounded rectangle behind white lettering on a transparent PNG: the
 * opaque pixels first met coming in from the transparent border, when they're
 * (mostly) one colour. Null when there's no margin or no single colour.
 */
async function detectPlateColour(png, { sharp = sharpLib } = {}) {
  if (!sharp) return null;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const clear = (j) => data[j * 4 + 3] < 24;
  const outside = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0; let tail = 0;
  const push = (j) => { if (!outside[j] && clear(j)) { outside[j] = 1; queue[tail++] = j; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  const ring = [];
  while (head < tail) {
    const j = queue[head++];
    const x = j % w; const y = (j - x) / w;
    for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) {
      if (k < 0) continue;
      if (clear(k)) push(k);
      else if (data[k * 4 + 3] >= 200) ring.push(k);
    }
  }
  if (ring.length < 20) return null;
  const mean = [0, 0, 0];
  for (const k of ring) for (let c = 0; c < 3; c++) mean[c] += data[k * 4 + c] / ring.length;
  const same = ring.filter((k) => Math.hypot(data[k * 4] - mean[0], data[k * 4 + 1] - mean[1], data[k * 4 + 2] - mean[2]) < RING_SAME).length;
  if (same / ring.length < RING_UNIFORM) return null;
  return `#${mean.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {Buffer} png a PNG (from processLogoUpload)
 * @param {string} bgHex the box colour (logoAnalyzer backgroundColor)
 * @param {{ edgeOnly?: boolean, requireRect?: boolean, sharp?: Function }} [opts]
 *   edgeOnly: remove only a plate connected to the image's border (edgePlate) —
 *   for logos the analyser didn't see as a box: a plate inside transparent
 *   margins, or a box with a shadow or uneven edge. requireRect: only a
 *   rectangular plate (for a coloured one, which could be an emblem's shape).
 * @returns {Promise<Buffer|null>} the PNG with the box transparent and trimmed, or null if nothing would be left
 */
async function knockoutBackground(png, bgHex, { sharp = sharpLib, edgeOnly = false, requireRect = false } = {}) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(bgHex || ''));
  if (!sharp || !m) return null;
  const n = parseInt(m[1], 16);
  const bg = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  // How far each pixel is from the box colour, 0 (the box) … 1 (as far as a channel can go).
  const pixels = data.length / 4;
  const dist = new Float32Array(pixels);
  const histogram = new Uint32Array(101);
  let strong = 0;
  for (let j = 0, i = 0; j < pixels; j++, i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const p = data[i + c];
      const q = bg[c];
      // Floored headroom: on an off-white box (#f8f7f3) "lighter than the box"
      // has only ~7 levels, so +2 of JPEG noise would otherwise read as 29% ink.
      const v = p > q ? (p - q) / Math.max(255 - q, MIN_HEADROOM) : p < q ? (q - p) / Math.max(q, MIN_HEADROOM) : 0;
      if (v > d) d = v;
    }
    // A see-through pixel is background, whatever RGB it happens to store (often black).
    dist[j] = data[i + 3] < 24 ? 0 : d;
    // See-through pixels aren't ink either.
    if (d >= MIN_INK_STRENGTH && data[i + 3] >= 24) { histogram[Math.round(d * 100)] += 1; strong += 1; }
  }
  if (strong / pixels < MIN_INK_SHARE) return null;
  // The ink's own strength: the INK_PERCENTILE-th distance among clearly-ink pixels.
  let inkStrength = 1;
  for (let b = 100, seen = 0; b >= 0; b--) {
    seen += histogram[b];
    if (seen >= strong * (1 - INK_PERCENTILE)) { inkStrength = Math.max(MIN_INK_STRENGTH, b / 100); break; }
  }

  let keep;
  if (edgeOnly) {
    const plate = edgePlate(data, dist, info.width, info.height, { requireRect });
    if (!plate) return null;
    // A confirmed rectangular plate is a box like any other: its colour goes
    // everywhere, counters inside the lettering included (enclosedArtwork
    // still keeps white artwork wrapped in thick colour). A white plate found
    // around other artwork removes only what touches the edge — white inside
    // the artwork may be part of it.
    keep = requireRect ? enclosedArtwork(data, dist, info.width, info.height) : plate.map((v) => (v ? 0 : 1));
  } else {
    keep = enclosedArtwork(data, dist, info.width, info.height);
  }

  let ink = 0;
  for (let j = 0, i = 0; j < pixels; j++, i += 4) {
    if (keep[j]) { // white artwork inside a coloured shape (or, edge mode, anything off the plate): as drawn
      if (data[i + 3] > 128) ink += 1;
      continue;
    }
    const alpha = Math.min(1, Math.max(0, (dist[j] - KNOCKOUT_TOLERANCE) / (inkStrength - KNOCKOUT_TOLERANCE)));
    if (alpha === 0) {
      data[i + 3] = 0;
      continue;
    }
    if (alpha < 1) {
      // Un-mix: the colour that, at this alpha over the box colour, gave the pixel.
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - bg[c]) / alpha + bg[c])));
      }
    }
    data[i + 3] = Math.round(data[i + 3] * alpha);
    if (data[i + 3] > 128) ink += 1;
  }
  if (ink / (info.width * info.height) < MIN_INK_SHARE) return null;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }) // no transparent margins: the CSS pads evenly
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

// ── Reversed variant. A see-through multicolour logo with dark lettering (the
// usual "emblem + company name" logo) can't sit directly on a dark header —
// the lettering vanishes — and putting it on a white plate brings the box
// back. Brands solve this with a reversed logo: the neutral parts flipped
// light, the brand colours untouched. Made here once, so a dark header shows
// only the artwork. (For a light logo, the same on a light header: neutrals
// flipped dark.)

const NEUTRAL_CHROMA = 40;        // max−min channel spread at or under which a pixel is "neutral"
const MIN_REVERSED_SHARE = 0.15;  // at least this much of the ink must be flippable for a reversal to matter
// A coloured pixel whose WCAG relative luminance is under this is "dark ink":
// it can't contrast with a dark header (whose own luminance is ~0.03–0.1).
// Navy #1f1f5f ≈ 0.02 and forest green #2c5a2a ≈ 0.08 are; a brand blue
// #2563eb ≈ 0.16 isn't, and is left alone.
const DARK_INK_LUM = 0.1;
const linear = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const relativeLuminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

// A pale tint of a dark colour's hue: the same hue, lightness 0.88, saturation capped.
function paleTint(r, g, b) {
  const max = Math.max(r, g, b) / 255; const min = Math.min(r, g, b) / 255;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r / 255) hue = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) hue = (b - r) / 255 / d + 2;
    else hue = (r - g) / 255 / d + 4;
  }
  hue = (hue * 60 + 360) % 360;
  const l = 0.88; const s = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255));
}

/**
 * @param {Buffer} png a see-through PNG
 * @param {'dark'|'light'} tone the logo's tone (logoAnalyzer); a dark logo's dark neutrals go light
 * @returns {Promise<Buffer|null>} the reversed PNG, or null when there's too little neutral ink to flip
 */
async function reverseNeutrals(png, tone, { sharp = sharpLib } = {}) {
  if (!sharp) return null;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const toLight = tone !== 'light';
  let inkCount = 0;
  let flipped = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 24) continue;
    inkCount += 1;
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (Math.max(r, g, b) - Math.min(r, g, b) > NEUTRAL_CHROMA) {
      // A brand colour is kept — unless it's dark ink (navy, forest green,
      // deep plum lettering), which vanishes on a dark header just like black.
      // That is lifted to a pale tint of its own hue, so it stays on-brand.
      if (!toLight || relativeLuminance(r, g, b) >= DARK_INK_LUM) continue;
      const [nr, ng, nb] = paleTint(r, g, b);
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
      flipped += 1;
      continue;
    }
    if (toLight ? lum >= 0.55 : lum <= 0.45) continue; // already reads on the target header
    const v = Math.round(255 * (1 - lum)); // the same tone, flipped, as a clean neutral
    data[i] = v; data[i + 1] = v; data[i + 2] = v;
    flipped += 1;
  }
  if (!inkCount || flipped / inkCount < MIN_REVERSED_SHARE) return null;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

const contentKey = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);

/**
 * The full logo pipeline: validate + re-encode (processLogoUpload), analyse,
 * knock out a near-white box, and make the reversed variant when one helps.
 * `appearance` describes the image as stored (so a knocked-out logo is
 * 'transparent'); `original` the image as given; `reversed` { data, key } or null.
 * @param {{ linked?: boolean, sharp?: Function, analyze?: Function }} [opts]
 *   linked: the bytes came from the tenant's site (any web image format).
 * @returns {Promise<{ data: Buffer, key: string, width: number, height: number, mimeType: 'image/png',
 *   appearance: object|null, original: object|null, knockedOut: boolean, reversed: { data: Buffer, key: string }|null }>}
 * @throws {LogoUploadError}
 */
async function prepareLogo(buffer, { linked = false, sharp = sharpLib, analyze } = {}) {
  const analyzeImage = analyze || require('./logoAnalyzer').analyzeLogo; // lazy: logoAnalyzer loads sharp too
  const base = await processLogoUpload(buffer, { sharp, linked });
  const original = await analyzeImage(base.data).catch(() => null);
  let data = base.data;
  let appearance = original;
  let knockedOut = false;
  // Only the artwork is kept — every solid background goes:
  //   - a uniform box of any colour filling the image (white, black, a brand
  //     colour) → removed everywhere, counters included;
  //   - anything else (see-through margins around a plate, a box with a
  //     shadow) → the near-white plate touching its border; failing that, a
  //     solid rectangular plate of any colour inside a see-through margin.
  // A photo/gradient background can't be separated from artwork reliably and
  // is left as it is.
  const box = original?.background;
  const lightMark = box === 'transparent' && original.tone === 'light'; // white lettering: no white plate to find
  let cleaned = null;
  if (box === 'light' || box === 'dark' || box === 'color') {
    cleaned = await knockoutBackground(base.data, original.backgroundColor, { sharp }).catch(() => null);
  } else {
    if (!lightMark) cleaned = await knockoutBackground(base.data, '#ffffff', { sharp, edgeOnly: true }).catch(() => null);
    if (!cleaned && box !== 'complex') {
      const plate = await detectPlateColour(base.data, { sharp }).catch(() => null);
      if (plate) cleaned = await knockoutBackground(base.data, plate, { sharp, edgeOnly: true, requireRect: true }).catch(() => null);
    }
  }
  if (cleaned) {
    data = cleaned;
    // Analysed with a see-through margin: the cleaned image is trimmed tight,
    // so artwork touches its edge and would otherwise be read as a box
    // (white lettering left from a removed block looks like a "light" box).
    const framed = await sharp(cleaned)
      .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer().catch(() => cleaned);
    const reread = await analyzeImage(framed).catch(() => null);
    appearance = { ...(reread || original), background: 'transparent', backgroundColor: null };
    knockedOut = true;
  }
  const meta = data === base.data ? { width: base.width, height: base.height } : await sharp(data).metadata();
  // A single-colour mark is recoloured by CSS (a badge tint) — no variant needed.
  // (Bump LOGO_PIPELINE_VERSION whenever this pipeline's output changes, so
  // stored logos are re-processed on the next save or rescan — branding.js.)
  let reversed = null;
  if (appearance?.background === 'transparent' && !appearance.monochrome) {
    const flipped = await reverseNeutrals(data, appearance.tone, { sharp }).catch(() => null);
    if (flipped) reversed = { data: flipped, key: contentKey(flipped) };
  }
  return {
    data,
    key: contentKey(data),
    width: meta.width,
    height: meta.height,
    mimeType: 'image/png',
    appearance,
    original,
    knockedOut,
    reversed
  };
}

/** The public path of an uploaded logo — relative: the widget and dashboard prefix their own API base. */
function logoAssetPath(tenantId, key) {
  return `/api/v1/public/brand-assets/logo/${encodeURIComponent(tenantId)}/${encodeURIComponent(key)}.png`;
}

module.exports = {
  processLogoUpload,
  prepareLogo,
  knockoutBackground,
  detectPlateColour,
  reverseNeutrals,
  sniffImageType,
  logoAssetPath,
  LogoUploadError,
  MAX_LOGO_UPLOAD_BYTES,
  MAX_LOGO_EDGE,
  ACCEPTED_LOGO_TYPES,
  LOGO_PIPELINE_VERSION,
  isLogoUploadAvailable: () => !!sharpLib
};
