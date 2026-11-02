// Automated Intelligent Product Extractor.
//
// One place that turns ANY ingested text — scraped Markdown, an uploaded
// PDF/.docx/.txt/.md parsed to Markdown, or a pasted note — into structured
// product rows for the ProductCatalog, so onboarding never needs a hand-made
// CSV. The caller (routes/tenantWorkspace.routes.js) feeds the output straight
// to catalogIngest.importExtractedProducts, which validates and upserts it.
//
// Two tiers, mirroring the rest of the pipeline's "cheap-and-safe by default,
// LLM only when asked" stance:
//   1. HEURISTIC (always available, free, deterministic, verbatim): regex over
//      Markdown tables, price-bearing bullet lists, and "## Heading + lead"
//      blocks. Because it only ever copies spans out of the source, it carries
//      no grounding or cost risk and is safe to run on every ingest. It is
//      precision-first on purpose: it emits a product only on a real signal (a
//      table row, or a price / image / buy-link near a name), so a blog page or
//      policy doc does not pollute the catalog with junk cards.
//   2. LLM (opt-in): when the caller passes useLlm, it also runs the existing
//      distillation pass (llmDistillation.distillMarkdown) and merges the
//      products it found — the richer recall for messy prose, at one LLM call.
//
// Nothing here throws to the caller: the LLM tier degrades to "no extra
// products" on any failure, exactly like distillation. Field shaping is light
// (trim, cap, http(s)-only URLs); catalogIngest.validateProduct is still the
// authority before any DB write, and SKUs are backfilled there from the name.

const { distillMarkdown } = require('./llmDistillation');

const MAX_PRODUCTS = 200;   // abuse/noise ceiling for one ingest
const MAX_NAME = 255;       // keep in step with catalogIngest MAX
const MAX_PRICE = 100;
const MAX_DESC = 2000;

// Currencies and amounts we recognise as a price: ₹ / Rs / INR / $ / US$ /
// USD / € / £ followed by a number. Kept verbatim (the column is free text, so
// "₹1,999", "$40", "Rs. 500/-" and ranges all survive as written).
const PRICE_RE = /(?:₹|rs\.?|inr|us\$|usd|\$|€|£)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:\/-|\bonly\b))?/i;
// A URL that points at an image file (used to tell an image link from a buy link).
const IMG_URL_RE = /https?:\/\/[^\s)<>"']+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s)<>"']*)?/i;
// Words that mark a link as a purchase/product link rather than a generic one.
const BUY_HINT_RE = /\b(buy|purchase|checkout|cart|shop|order|product|view|add\s*to)\b/i;
// Generic section titles that are never a product name on their own.
const SECTION_NAME_RE =
  /^(products?|our\s+(range|products|collection)|catalog(ue)?|shop|store|pricing|prices?|price\s*list|menu|faqs?|overview|home|about(\s+us)?|contact|features?|benefits?|testimonials?)$/i;

const envFlag = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/** Auto heuristic extraction on every ingest. On unless AUTO_PRODUCT_EXTRACTION is explicitly falsey. */
function isAutoProductExtractionEnabled() {
  const v = String(process.env.AUTO_PRODUCT_EXTRACTION ?? '').trim();
  return v === '' ? true : envFlag(v);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const httpOrEmpty = (v) => { const s = clean(v); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };

// Strip Markdown so a heading/cell becomes a plain name: drop images, turn
// [text](url) into text, remove emphasis/heading/quote marks and a leading bullet.
function stripMd(s) {
  return clean(String(s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
}

/** Auto-generate a SKU from a product name (slug), bounded to the column size. */
function slugifySku(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'item';
}

// First image URL in a span: a Markdown image first, then a bare image URL.
function firstImage(s) {
  const str = String(s || '');
  const md = str.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i);
  if (md) return md[1];
  const raw = str.match(IMG_URL_RE);
  return raw ? raw[0] : '';
}

// First purchase/product link in a span: prefer a link whose text or href
// hints at buying; else the first non-image link; else a bare non-image URL.
function firstBuyLink(s) {
  const str = String(s || '');
  const links = [...str.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)];
  for (const [, text, href] of links) {
    if ((BUY_HINT_RE.test(text) || BUY_HINT_RE.test(href)) && !IMG_URL_RE.test(href)) return href;
  }
  for (const [, , href] of links) { if (!IMG_URL_RE.test(href)) return href; }
  const raw = [...str.matchAll(/https?:\/\/[^\s)<>"']+/gi)].map((m) => m[0]).filter((u) => !IMG_URL_RE.test(u));
  return raw[0] || '';
}

// Split "Name — ₹999 rest" into its parts. Everything before the first price is
// the name; the price itself is kept verbatim; whatever follows is a description.
function splitNamePrice(text) {
  const t = clean(text);
  const m = t.match(PRICE_RE);
  if (!m) return { name: stripMd(t), price: '', rest: '' };
  const name = stripMd(t.slice(0, m.index).replace(/[\s–—:|.-]+$/, ''));
  const rest = stripMd(t.slice(m.index + m[0].length).replace(/^[\s–—:|.-]+/, ''));
  return { name: name || stripMd(t), price: clean(m[0]), rest };
}

// ── Markdown tables ─────────────────────────────────────────────────────────
function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
function isSeparatorRow(line) {
  if (!line || !line.includes('|')) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
}

// Assign each header cell one role (first match wins). imageUrl/productUrl are
// tested before name so a "Product URL" column is a link, not the name column.
function mapColumns(headers) {
  const roles = [
    ['imageUrl', /(image|img|photo|thumb|picture)/i],
    ['productUrl', /(buy|purchase|checkout|cart|\bshop\b|product\s*url|\blink\b|\burl\b)/i],
    ['sku', /\b(sku|code|item\s*id)\b/i],
    ['price', /(price|cost|mrp|amount|rate)/i],
    ['description', /(description|details?|\bdesc\b|about)/i],
    ['name', /(product|item|name|title)/i]
  ];
  const map = {};
  headers.forEach((h, idx) => {
    const norm = String(h || '').toLowerCase();
    for (const [role, re] of roles) { if (map[role] == null && re.test(norm)) { map[role] = idx; break; } }
  });
  return map;
}

function urlFromCell(cell) {
  const s = String(cell || '');
  const md = s.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i); if (md) return md[1];
  const link = s.match(/\]\((https?:\/\/[^\s)]+)\)/); if (link) return link[1];
  const raw = s.match(/https?:\/\/[^\s)<>"']+/i); return raw ? raw[0] : '';
}

// Pull every Markdown table out of the text and turn each data row into a
// product. Returns the products plus the text with the tables removed, so the
// list/heading passes don't see those lines again.
function extractTables(src) {
  const lines = src.split('\n');
  const products = [];
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    if (header && header.includes('|') && isSeparatorRow(lines[i + 1])) {
      const map = mapColumns(splitCells(header));
      if (map.name != null) {
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
          const cells = splitCells(lines[j]);
          const name = stripMd(cells[map.name] || '');
          if (name) {
            const joined = cells.join(' ');
            products.push({
              name,
              sku: map.sku != null ? clean(cells[map.sku]) : '',
              price: map.price != null ? clean(cells[map.price]) : clean(joined.match(PRICE_RE)?.[0] || ''),
              description: map.description != null ? stripMd(cells[map.description] || '') : '',
              imageUrl: map.imageUrl != null ? urlFromCell(cells[map.imageUrl]) : firstImage(joined),
              productUrl: map.productUrl != null ? urlFromCell(cells[map.productUrl]) : firstBuyLink(joined)
            });
          }
          j++;
        }
        i = j;
        continue;
      }
    }
    kept.push(header);
    i++;
  }
  return { products, rest: kept.join('\n') };
}

// Bullet / numbered list items that carry a price: "- Whey Protein — ₹1999".
function extractBulletItems(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!m || !PRICE_RE.test(m[1])) continue;
    const { name, price, rest } = splitNamePrice(m[1]);
    if (name) out.push({ name, price, description: rest, imageUrl: firstImage(m[1]), productUrl: firstBuyLink(m[1]) });
  }
  return out;
}

// "## Heading" blocks whose heading or immediate lead line carries a price,
// image or buy link — a single described product. A section whose lead line is
// itself a bullet is left to the bullet pass; a generic section title (Products,
// Pricing, …) is never a product name.
function extractHeadingBlocks(text) {
  const out = [];
  const lines = text.split('\n');
  let cur = null;
  const flush = () => {
    if (cur) {
      const body = cur.body.join('\n');
      const lead = cur.body.find((l) => l.trim()) || '';
      const name = stripMd(cur.heading);
      const scope = `${cur.heading}\n${lead}`;
      const leadIsBullet = /^\s*(?:[-*•]|\d+[.)])\s+/.test(lead);
      const signal = PRICE_RE.test(scope) || firstImage(scope) || firstBuyLink(scope);
      if (!leadIsBullet && signal && name && !SECTION_NAME_RE.test(name)) {
        const np = splitNamePrice(cur.heading);
        out.push({
          name: np.name || name,
          price: np.price || clean(body.match(PRICE_RE)?.[0] || ''),
          description: describeBody(body),
          imageUrl: firstImage(scope) || firstImage(body),
          productUrl: firstBuyLink(scope) || firstBuyLink(body)
        });
      }
    }
    cur = null;
  };
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) { flush(); cur = { heading: h[1], body: [] }; }
    else if (cur) cur.body.push(line);
  }
  flush();
  return out;
}

function describeBody(body) {
  const noMedia = String(body).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return stripMd(noMedia).slice(0, 280);
}

// Shape to the card field set, drop the nameless, and de-duplicate by SKU
// (preferred) or lowercased name. First occurrence wins.
function shapeAndDedupe(items) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(items) ? items : []) {
    const name = clean(p && p.name).slice(0, MAX_NAME);
    if (!name) continue;
    const sku = clean(p && p.sku);
    const key = (sku || name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      sku,
      price: clean(p.price).slice(0, MAX_PRICE),
      description: clean(p.description).slice(0, MAX_DESC),
      imageUrl: httpOrEmpty(p.imageUrl),
      productUrl: httpOrEmpty(p.productUrl)
    });
    if (out.length >= MAX_PRODUCTS) break;
  }
  return out;
}

/**
 * Heuristic-only extraction (synchronous, never throws). Tables first (the
 * strongest signal), then described heading blocks, then price-bearing bullets.
 * @param {string} text  Markdown or plain text
 * @returns {Array<{name,sku,price,description,imageUrl,productUrl}>}
 */
function extractProductsHeuristic(text) {
  const src = String(text || '');
  if (!src.trim()) return [];
  const { products, rest } = extractTables(src);
  return shapeAndDedupe([...products, ...extractHeadingBlocks(rest), ...extractBulletItems(rest)]);
}

/** Merge several product lists into one shaped, de-duplicated list (first wins). */
function mergeProducts(...lists) {
  return shapeAndDedupe(lists.flat().filter(Boolean));
}

/**
 * Full extraction: heuristic always; plus the LLM distillation pass when
 * `useLlm` is set and an LLM is configured. The heuristic list is placed first,
 * so its verbatim-from-source items win on any SKU/name collision. Never throws.
 * @param {string} text
 * @param {{ title?: string, useLlm?: boolean, generate?: Function, distill?: Function }} [opts]
 *   generate/distill are injectable for tests.
 * @returns {Promise<Array<object>>}
 */
async function extractProducts(text, { title = '', useLlm = false, generate, distill = distillMarkdown } = {}) {
  const heuristic = extractProductsHeuristic(text);
  if (!useLlm) return heuristic;
  let llm = [];
  try {
    const r = await distill(String(text || ''), { title, ...(generate ? { generate } : {}) });
    llm = Array.isArray(r && r.products) ? r.products : [];
  } catch (err) {
    console.warn(`[productExtractor] LLM extraction skipped: ${err.message}`);
  }
  return mergeProducts(heuristic, llm);
}

module.exports = {
  extractProducts,
  extractProductsHeuristic,
  mergeProducts,
  slugifySku,
  isAutoProductExtractionEnabled
};
