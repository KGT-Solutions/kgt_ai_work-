// Tier 3 of the scraping pipeline: an OPTIONAL, LLM-assisted "noise eraser".
// After the crawler (crawler.js) has produced exhaustive raw Markdown for a
// page, this runs one lightweight LLM pass to strip the layout/chrome debris
// that element stripping couldn't, restructure the core business knowledge into
// clean "## " sections, and — when a page clearly describes purchasable items —
// surface a structured product payload for the ProductCatalog.
//
// It is DISABLED by default (SCRAPE_DISTILLATION) for three reasons the caller
// must weigh: (1) cost/latency — it is one LLM call PER PAGE, so a large crawl
// is a large bill and a slow request; (2) grounding — distilled text is
// LLM-rewritten, not source-verbatim, which is a deliberate shift from this
// platform's "answer only from source excerpts" stance; (3) safety — an LLM can
// drop or alter facts. Every guard here is built around those risks:
//   - never throws: any failure (LLM down, timeout, bad output) falls back to
//     the exact raw Markdown, so distillation can only ever be a no-op, never a
//     data-loss step;
//   - a distilled page that lost most of its words (a sign the model summarized
//     content away) is rejected in favour of the raw text;
//   - extracted products are only lightly shaped here; the caller still runs
//     them through catalogIngest's strict validateProduct before any DB write.

const { generateAnswer, isLlmConfigured } = require('../../engine/llmClient');

const envInt = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const envFlag = (name) => /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());

// How many pages of a single crawl to distill (the rest are kept raw), and how
// many LLM passes to run at once. Conservative by default — this is billable.
const DISTILL_MAX_PAGES = envInt('SCRAPE_DISTILLATION_MAX_PAGES', 25);
const DISTILL_CONCURRENCY = envInt('SCRAPE_DISTILLATION_CONCURRENCY', 2);
const DISTILL_MAX_TOKENS = envInt('SCRAPE_DISTILLATION_MAX_TOKENS', 2048);
// Below this the input is too short to be worth a round-trip (and too short to
// contain much chrome worth erasing) — kept raw.
const MIN_WORDS_TO_DISTILL = envInt('SCRAPE_DISTILLATION_MIN_WORDS', 40);
// If the distilled text keeps less than this fraction of the raw word count, we
// assume the model summarized real content away and keep the raw text instead.
const MIN_RETAINED_FRACTION = 0.35;
const MAX_PRODUCTS_PER_PAGE = 50;

const SYSTEM_PROMPT =
  'You are an expert data distillation agent for an enterprise AI platform. Review the provided raw ' +
  'scraped web text. Strip out all remaining website navigation chrome, repetitive footer legal text, ' +
  'marketing fluff, and layout debris. Extract, clean, and structure the core business knowledge into ' +
  'crisp Markdown sections: Product Specs, Pricing/Combos, Business Policies, and FAQs.\n\n' +
  'STRICT RULES:\n' +
  '- Preserve every concrete fact, number, price, SKU, spec and policy detail EXACTLY as written. Never ' +
  'invent anything and never summarize specifics away — remove only chrome and fluff, keep all substance.\n' +
  "- Use '## ' Markdown headings for each section so the result can be chunked. Keep existing Markdown " +
  'tables intact.\n' +
  '- Output only the cleaned Markdown. Do not describe what you did.\n' +
  '- If (and only if) the text clearly describes purchasable products or courses, append at the very end ' +
  'a single fenced ```json code block containing an array of objects with the keys: name, sku, price, ' +
  'description, imageUrl, productUrl. Use "" for any field not present in the text. Include only items ' +
  'actually described in the text. If there are no such products, append no code block.';

function wordCount(s) {
  return String(s || '').split(/\s+/).filter(Boolean).length;
}

// Pull every ```json ... ``` fenced block out of the model's reply. Returns the
// text with those blocks removed, plus the parsed contents of the LAST one (the
// products block the prompt asks for at the end).
function splitJsonBlocks(text) {
  const blocks = [];
  const stripped = String(text || '').replace(/```json\s*([\s\S]*?)```/gi, (_, body) => {
    blocks.push(body);
    return '';
  }).trim();
  let parsed = null;
  for (let i = blocks.length - 1; i >= 0 && parsed === null; i--) {
    try {
      const value = JSON.parse(blocks[i].trim());
      if (Array.isArray(value)) parsed = value;
    } catch {
      /* ignore a malformed block and try the previous one */
    }
  }
  return { markdown: stripped, products: parsed || [] };
}

const asStr = (v) => (v === undefined || v === null ? '' : String(v).trim());
const httpUrlOrEmpty = (v) => { const s = asStr(v); return /^https?:\/\/\S+$/i.test(s) ? s : ''; };

// Light shaping only — the caller applies catalogIngest's strict validation
// before any insert. Drops anything without a name; coerces every field to a
// trimmed string; keeps only http(s) URLs.
function cleanProducts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = asStr(item.name);
    if (!name) continue;
    out.push({
      name,
      sku: asStr(item.sku),
      price: asStr(item.price),
      description: asStr(item.description),
      imageUrl: httpUrlOrEmpty(item.imageUrl),
      productUrl: httpUrlOrEmpty(item.productUrl)
    });
    if (out.length >= MAX_PRODUCTS_PER_PAGE) break;
  }
  return out;
}

/**
 * Distill one page's raw Markdown. NEVER throws — on any problem it returns the
 * raw Markdown unchanged with no products, so the pipeline degrades to the
 * pre-distillation behaviour rather than losing content.
 * @param {string} raw  the crawler's raw Markdown for one page
 * @param {{ title?: string, generate?: Function }} [opts]  generate: injectable
 *   LLM call (tests); defaults to the configured llmClient.generateAnswer.
 * @returns {Promise<{ markdown: string, products: Array<object>, distilled: boolean }>}
 */
async function distillMarkdown(raw, { title = '', generate = generateAnswer } = {}) {
  const source = String(raw || '');
  const rawWords = wordCount(source);
  if (rawWords < MIN_WORDS_TO_DISTILL) return { markdown: source, products: [], distilled: false };
  // When using the real client, skip the round-trip entirely if nothing is configured.
  if (generate === generateAnswer && !isLlmConfigured()) return { markdown: source, products: [], distilled: false };

  try {
    const userPrompt = (title ? `Page title: ${title}\n\n` : '') + 'Raw scraped text:\n\n' + source;
    const result = await generate({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: DISTILL_MAX_TOKENS });
    const text = asStr(result?.text);
    if (!text) return { markdown: source, products: [], distilled: false };

    const { markdown, products } = splitJsonBlocks(text);
    // Guard against the model summarizing content away: if the cleaned text
    // kept too little of the original, trust the raw text instead.
    if (!markdown || wordCount(markdown) < rawWords * MIN_RETAINED_FRACTION) {
      return { markdown: source, products: cleanProducts(products), distilled: false };
    }
    return { markdown, products: cleanProducts(products), distilled: true };
  } catch (err) {
    console.warn(`[llmDistillation] falling back to raw text: ${err.message}`);
    return { markdown: source, products: [], distilled: false };
  }
}

/**
 * Distill a crawl's pages (bounded by cost caps), returning cleaned pages plus
 * the de-duplicated products found across them. Pages beyond the per-crawl cap
 * are passed through unchanged. Order is preserved.
 * @param {Array<{ title: string, markdown: string, url: string, rendered?: boolean }>} pages
 * @param {{ generate?: Function, maxPages?: number, concurrency?: number }} [opts]
 * @returns {Promise<{ pages: Array<object>, products: Array<object>, distilledCount: number }>}
 */
async function distillPages(pages, { generate = generateAnswer, maxPages = DISTILL_MAX_PAGES, concurrency = DISTILL_CONCURRENCY } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const out = new Array(list.length);
  const products = [];
  const seen = new Set(); // dedupe key: sku (preferred) or lowercased name
  let distilledCount = 0;

  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const i = cursor++;
      const page = list[i];
      if (i >= maxPages) { out[i] = page; continue; } // past the cost cap — keep raw
      const { markdown, products: found, distilled } = await distillMarkdown(page.markdown, { title: page.title, generate });
      out[i] = { ...page, markdown };
      if (distilled) distilledCount += 1;
      for (const p of found) {
        const key = (p.sku || p.name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        products.push(p);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker));
  return { pages: out, products, distilledCount };
}

/** Whether the scrape route should run Tier 3 at all (SCRAPE_DISTILLATION). */
function isDistillationEnabled() {
  return envFlag('SCRAPE_DISTILLATION');
}

/** Whether distillation-extracted products may be imported (SCRAPE_DISTILLATION_PRODUCTS). */
function isProductImportEnabled() {
  return envFlag('SCRAPE_DISTILLATION_PRODUCTS');
}

module.exports = {
  distillMarkdown,
  distillPages,
  splitJsonBlocks,
  cleanProducts,
  isDistillationEnabled,
  isProductImportEnabled,
  SYSTEM_PROMPT
};
