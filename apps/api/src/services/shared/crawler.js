// Auto-training web crawler: given a company's website URL, fetches a
// bounded set of same-domain pages, strips chrome (script/style/nav/footer/
// etc.), and converts each page's remaining heading+paragraph structure into
// the same "## Heading" markdown shape knowledgeLoader.parseIntoChunks
// already expects from a hand-pasted TenantDocument — a scraped page chunks
// exactly like a manually authored one; no new parsing path needed anywhere
// downstream. Deliberately domain-agnostic (no Prisma, no Express) so it
// lives in services/shared/ alongside lexicalSearch.js, not routes/.

// cheerio 1.x eagerly requires undici (for its optional fromURL() helper,
// which this file never calls), and undici references the global `File`
// class that Node only globalizes from v20. Polyfill it from `buffer`
// (present since Node 18, just not global) so a plain `require('cheerio')`
// doesn't crash on this project's Node 18 runtime.
if (typeof globalThis.File === 'undefined') {
  globalThis.File = require('buffer').File;
}

const dns = require('dns').promises;
const { URL } = require('url');
const cheerio = require('cheerio');
const { extractBrandSignals, resolveBrand } = require('./brandExtractor');
const { analyzeLogo } = require('./logoAnalyzer');
const { isPrivateIPv4, isPrivateIPv6, isPrivateAddress, privateHostsAllowed, publicAgent } = require('./netGuard');

const envInt = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};

// Crawl ceilings — comprehensive by default and fully tunable per deployment
// via env, so a large product catalog or course library is ingested end to
// end (pagination and sub-pages included) rather than truncated at a dozen
// pages. The wall-clock budget is the real safety net behind the page/depth
// caps, and CONCURRENCY stays modest so the crawl stays polite to the target
// server. These bound only ONE crawl: the dashboard /scrape route additionally
// enforces MAX_DOCUMENTS_PER_TENANT (500) and a per-tenant rate limit, and the
// signup wizard persists at most MAX_PAGES_ON_COMPLETE pages — those are what
// ultimately cap what lands in the database. Raise CRAWLER_MAX_PAGES /
// CRAWLER_BUDGET_MS for genuinely huge sites (and give any reverse proxy a
// matching read timeout, since the scan is synchronous).
const MAX_PAGES = envInt('CRAWLER_MAX_PAGES', 150);
const MAX_DEPTH = envInt('CRAWLER_MAX_DEPTH', 6);
const CONCURRENCY = envInt('CRAWLER_CONCURRENCY', 4);
const TOTAL_BUDGET_MS = envInt('CRAWLER_BUDGET_MS', 120000);
const PER_REQUEST_TIMEOUT_MS = envInt('CRAWLER_REQUEST_TIMEOUT_MS', 8000);
// Below this word count a page is treated as a stub/redirect/JS shell (and, in
// Tier 2, a candidate for a headless render). Deliberately low so short but
// real product/course pages are still saved; set CRAWLER_MIN_WORDS=1 to keep
// virtually everything.
const MIN_WORDS_PER_PAGE = envInt('CRAWLER_MIN_WORDS', 15);
const MAX_REDIRECTS = 3;

// Tier 1 page-quality floors. A page must clear MIN_CONTENT_WORDS of real text
// to be SAVED as a document (following its links is a separate decision), and a
// page that is mostly links with little prose — a thin index/directory — is
// dropped by the link-density check. Focus-directory pages (isFocusPath) get
// the lenient MIN_WORDS_PER_PAGE floor so a short product/course page is never
// discarded. Default MIN_CONTENT_WORDS equals MIN_WORDS_PER_PAGE (no behaviour
// change out of the box); set CRAWLER_MIN_CONTENT_WORDS higher (e.g. 80) to
// aggressively drop thin pages.
const MIN_CONTENT_WORDS = envInt('CRAWLER_MIN_CONTENT_WORDS', MIN_WORDS_PER_PAGE);
const MAX_LINK_RATIO = (() => {
  const v = Number(process.env.CRAWLER_MAX_LINK_RATIO);
  return Number.isFinite(v) && v > 0 ? v : 1.5; // links-per-content-word; a thin index page runs far higher
})();
// The conventional form for an honest crawler ("Mozilla/5.0 (compatible;
// <bot>)", like Googlebot's): many CDNs reject any user agent that doesn't
// start with Mozilla/5.0, while this one still names the bot. It never
// pretends to be a browser — sites that deliberately block bots stay
// blocked, and crawlSite says so (see describeStartFailure).
const USER_AGENT = 'Mozilla/5.0 (compatible; KGTAIHubBot/1.0)';
const REQUEST_HEADERS = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'accept-language': 'en-US,en;q=0.9'
};

// Same-domain links whose href/anchor text mention these are crawled before
// any other discovered link — the pages the prospect's admin actually wants
// trained on, per the feature request (About/FAQ/Support/Pricing).
const PRIORITY_KEYWORDS = ['about', 'faq', 'pricing', 'plans', 'support', 'help', 'contact', 'service', 'feature'];

// ── Tier 1: pre-fetch URL path gatekeeper. Drop utility/noise paths before we
// ever fetch them (carts, logins, account, search, pagination), and give
// genuine content directories first claim on the page budget. Pagination query
// strings are already collapsed by dedupeKey (search is stripped), so this
// mainly stops /page/N path-style pagination and the utility sections.
const NOISE_PATH = /\/(cart|checkout|basket|account|my-account|login|signin|sign-in|logout|signup|sign-up|register|search|wishlist|compare|orders?|returns?|track-order|page\/\d+)(\/|$)/i;
const NOISE_QUERY = /[?&](add-to-cart|replytocom|share|sessionid)=/i;
// Content directories worth crawling first (Shopify/WooCommerce/course sites):
// /products/, /collections/, /pages/, /blogs/, plus a few common equivalents.
// Plural "blogs/" (the Shopify CMS section) is focus; a singular "/blog/post"
// article path is left to the normal keyword priority, so it doesn't outrank
// About/Pricing on a tight budget.
const FOCUS_PATH = /\/(products?|collections?|pages|blogs|courses?|catalog(ue)?)\//i;

function isNoisyPath(urlObj) {
  return NOISE_PATH.test(urlObj.pathname) || NOISE_QUERY.test(urlObj.search || '');
}
function isFocusPath(urlObj) {
  return FOCUS_PATH.test(urlObj.pathname);
}

const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside',
  'iframe', 'svg', 'form', 'button', 'template',
  // Real sites frequently mark chrome with an ARIA landmark role instead of
  // (or in addition to) the matching semantic tag — a <div role="navigation">
  // mega-menu or a <div role="complementary"> sidebar is exactly as much
  // noise as a <nav>/<aside>, just not spelled that way.
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
  '[aria-hidden="true"]', '.cookie-banner', '.cookie-consent',
  // OneTrust is the consent manager behind most large storefronts' cookie
  // banners, and it doesn't use a generic .cookie-* class.
  '#onetrust-banner-sdk', '#onetrust-consent-sdk',
  // E-commerce-specific chrome (GNC and similar storefronts): cart drawers,
  // modals/popups, newsletter signup blocks, search bars, breadcrumb trails,
  // and menu/dropdown widgets that live outside a <nav> but are just as much
  // UI, not product content.
  '.cart', '.mini-cart', '.cart-drawer', '.modal', '.popup', '.newsletter',
  '.search-bar', '.breadcrumb', '.breadcrumbs', '.sidebar', '.menu', '.dropdown',
  // Tier 2 junk: floating newsletter/subscribe popups, "related products" /
  // upsell / recommendation carousels, and social-sharing widgets — chrome
  // that survives the semantic strips above and otherwise pollutes the text.
  '.newsletter-popup', '.popup-newsletter', '.subscribe', '.subscription', '.signup-popup',
  '.related', '.related-products', '.related-items', '.you-may-also-like', '.upsell', '.cross-sell',
  '.recommendations', '.recommended', '.product-carousel', '.carousel', '.slider', '.swiper',
  '.share', '.sharing', '.social', '.social-share', '.social-links', '.share-buttons', '.addthis', '.sharethis',
  '.gdpr', '.consent', '.cookie-notice', '[class*="newsletter"]', '[aria-label="Cookie banner"]'
].join(',');

// UI labels/boilerplate that sometimes survive element-level stripping (e.g. a
// "Your cart is empty" message rendered as a <p> inside a div that isn't itself
// matched by STRIP_SELECTORS). PRECISION over aggression — the goal is to drop
// pure layout chrome while never deleting a real product description, price,
// spec or service term. Two tiers:
//   EXACT: matches only a line that, once trimmed, is nothing BUT the label
//     itself — so a bare nav/button word like "Menu", "Cart" or "Search" is
//     dropped, while a real sentence that merely contains it ("See our full
//     menu of services") is kept, because EXACT never matches as a substring.
//   SUBSTRING: a few multi-word phrases that are unambiguously footer/consent
//     chrome, matched only on a short (<=15-word) line. Commerce phrases such
//     as "add to cart", "in stock" and "free shipping" were REMOVED from this
//     list on purpose: "Free shipping on orders over $50" and "In stock now"
//     are genuine product facts the bots should answer from, not clutter.
const BOILERPLATE_EXACT = new Set([
  'menu', 'search', 'cart', 'my account', 'account', 'wishlist', 'compare',
  'sign in', 'log in', 'login', 'sign up', 'register', 'home', 'close',
  'skip to content', 'skip to main content', 'back to top', 'read more'
]);

const BOILERPLATE_SUBSTRINGS = [
  'your cart is empty', 'all rights reserved', 'cookie policy', 'privacy policy',
  'terms of service', 'terms and conditions', 'we use cookies', 'accept cookies',
  'subscribe to our newsletter', 'follow us on'
];

const BOILERPLATE_SUBSTRING_MAX_WORDS = 15;

function isBoilerplateLine(text) {
  const clean = text.trim().toLowerCase();
  if (!clean) return true;
  if (BOILERPLATE_EXACT.has(clean)) return true;
  if (clean.split(/\s+/).length > BOILERPLATE_SUBSTRING_MAX_WORDS) return false;
  return BOILERPLATE_SUBSTRINGS.some((phrase) => clean.includes(phrase));
}

// Comprehensive extraction: capture the WHOLE <body> (after STRIP_SELECTORS
// removes nav/header/footer/scripts/consent chrome) by default, so custom
// layouts, product grids and sites with no semantic landmarks never lose
// content. A semantic <main>/<article> is used as a tighter scope ONLY when
// one exists AND it actually carries content — a precise signal that avoids a
// site's global promo rails without the old hardcoded class guesses
// (.product-description/#content/etc.), which simply failed on custom markup.
// The content floor is what lets a JS-hydrated storefront's empty
// <main id="app"> shell fall through to the server-rendered body.
const PREFERRED_CONTAINERS = ['main', 'article'];

class CrawlerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CrawlerError';
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------
// SSRF safety. A server fetching a URL someone typed in: loopback, private,
// link-local and cloud-metadata targets must be unreachable, on every redirect
// hop. Two layers, both from netGuard.js:
//   1. assertPublicHost — an early, cheap refusal before any request, and the
//      ONLY check an IP-literal URL gets (sockets dial literals directly).
//   2. publicAgent — fetchSafe's dispatcher, which re-checks every address in
//      the connection itself. Layer 1 alone was beatable by DNS rebinding:
//      a hostile DNS server answers this check with a public IP and the
//      connection's own lookup with an internal one (verified exploitable).
// ---------------------------------------------------------------------

const nonPublicError = (hostname) => new CrawlerError(`"${hostname}" resolves to a non-public address — refusing to crawl it`, 400);

// CRAWLER_ALLOW_PRIVATE_HOSTS=true lifts both layers so the E2E suite can scan
// its fixture website on a private Docker network. It turns the crawler into
// an SSRF tool, so production refuses to start with it (utils/assertProdSafety.js).
async function assertPublicHost(hostname) {
  if (privateHostsAllowed()) return;
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new CrawlerError(`Could not resolve "${hostname}"`, 400);
  }
  if (addresses.some(({ address, family }) => isPrivateAddress(address, family))) throw nonPublicError(hostname);
}

function assertHttpUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new CrawlerError('That is not a valid URL', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlerError('Only http/https URLs are supported', 400);
  }
  return parsed;
}

// ---------------------------------------------------------------------
// Fetching, with manual (re-validated) redirect handling.
// ---------------------------------------------------------------------

const isHtml = (contentType) => contentType.includes('html');
const isCss = (contentType) => contentType.includes('css') || contentType.includes('text/plain');
const isImage = (contentType) => contentType.startsWith('image/');

// The default cap for a body read as text (pages, stylesheets): far above any
// real page, far below what would hurt the process.
const MAX_HTML_BYTES = 3 * 1024 * 1024;

/**
 * A response body read under a byte cap. Reads chunk by chunk and stops the
 * moment the cap is passed, cancelling the rest of the stream — res.text() /
 * arrayBuffer() would buffer an unbounded (chunked) body in full before any
 * size check could run.
 *
 * `signal` (the request's timeout) is watched here directly: on abort the
 * reader is cancelled, which ends a pending read even when the stream's source
 * ignores the abort — Node's fetch errors its own body streams on abort, but
 * the timeout must not depend on that.
 * @param {Response} res
 * @param {{ maxBytes: number, binary?: boolean, overflow?: 'truncate'|'reject', signal?: AbortSignal }} opts
 *   overflow: 'truncate' keeps the first maxBytes (text); 'reject' returns null
 *   (binary — a cut-off image is useless).
 * @returns {Promise<string|Buffer|null>}
 * @throws {Error} name 'AbortError' when the signal fires mid-read
 */
async function readBody(res, { maxBytes, binary = false, overflow = 'truncate', signal } = {}) {
  if (!res.body) return binary ? Buffer.alloc(0) : '';
  const reader = res.body.getReader();
  const aborted = () => Object.assign(new Error('The response body read was aborted'), { name: 'AbortError' });
  // Cancelling the reader resolves a pending read() with done:true; the
  // aborted checks below turn that into an error rather than a short body.
  const onAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw aborted();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw aborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        if (overflow === 'reject') return null;
        chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  const buf = Buffer.concat(chunks);
  return binary ? buf : buf.toString('utf8');
}

// Release a response we won't read: an unconsumed body keeps its connection busy.
function discardBody(res) {
  if (res.body) res.body.cancel().catch(() => {});
}

// accept: which content types the caller reads (HTML pages by default; the
// brand scan also reads stylesheets and the logo image). maxBytes: the body
// cap (default MAX_HTML_BYTES) — text is truncated at it; a binary body over
// it is refused (null), early when Content-Length already says so.
// responseType 'buffer' returns { body: Buffer } (images) instead of { html }.
async function fetchSafe(urlString, { timeoutMs = PER_REQUEST_TIMEOUT_MS, accept = isHtml, maxBytes = 0, responseType = 'text' } = {}) {
  let current = assertHttpUrl(urlString);
  const binary = responseType === 'buffer';
  const cap = maxBytes || MAX_HTML_BYTES;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname);

    // ONE timer for the whole exchange — headers and body. It used to be
    // cleared once headers arrived, so a server that sent headers and then
    // trickled (or never finished) the body held the request open forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const failure = (err) => {
      // The dispatcher refused a non-public address at dial time (DNS rebinding,
      // or a name that only now resolves privately): an SSRF refusal, not an outage.
      if (err?.cause?.code === 'EPRIVATE' || err?.code === 'EPRIVATE') return nonPublicError(current.hostname);
      const timedOut = controller.signal.aborted;
      const e = new CrawlerError(
        timedOut ? `${current.hostname} did not respond within ${timeoutMs / 1000} seconds` : `Could not reach ${current.hostname}: ${err.message}`,
        502
      );
      e.kind = timedOut ? 'timeout' : 'unreachable'; // read by describeStartFailure
      return e;
    };
    try {
      let res;
      try {
        res = await fetch(current.toString(), {
          redirect: 'manual', signal: controller.signal, headers: REQUEST_HEADERS,
          dispatcher: publicAgent // every connection re-checks its address (anti DNS rebinding)
        });
      } catch (err) {
        throw failure(err);
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        discardBody(res);
        const location = res.headers.get('location');
        if (!location) throw new CrawlerError(`Redirect from ${current} had no Location header`, 502);
        current = new URL(location, current);
        if (current.protocol !== 'http:' && current.protocol !== 'https:') {
          throw new CrawlerError('Refusing to follow a redirect to a non-http(s) URL', 400);
        }
        continue;
      }

      if (!res.ok) {
        discardBody(res);
        const err = new CrawlerError(`${current} returned HTTP ${res.status}`, 502);
        err.httpStatus = res.status; // lets crawlSite tell "blocked" (403) from "missing" (404)
        throw err;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!accept(contentType)) { // a type the caller doesn't read (PDF/image/etc.) — it skips it
        discardBody(res);
        return null;
      }
      if (binary && Number(res.headers.get('content-length')) > cap) {
        discardBody(res);
        return null;
      }

      let body;
      try {
        body = await readBody(res, { maxBytes: cap, binary, overflow: binary ? 'reject' : 'truncate', signal: controller.signal });
      } catch (err) {
        throw failure(err);
      }
      if (body === null) return null;
      return binary ? { body, finalUrl: current } : { html: body, finalUrl: current };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new CrawlerError('Too many redirects', 502);
}

// ---------------------------------------------------------------------
// HTML -> structured markdown. Exhaustive: a recursive walk captures text from
// every content element — headings, paragraphs, lists, definition lists,
// blockquotes, tables, AND generic containers (div/section/article) and the
// inline text inside them — so product cards, feature grids, spec sheets and
// custom layouts are never skipped. Two rules keep it from double-counting on
// deeply nested markup: a text block (p/li/dt/dd/td/th/…) contributes its own
// inline text once (its nested block children are visited separately), and a
// generic container contributes text directly only when it has no block
// descendant to descend into (a leaf <div class="price">$40</div>), otherwise
// just its loose direct text. Tables are converted to real Markdown tables.
// ---------------------------------------------------------------------

function cleanText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} html
 * @param {URL} pageUrl
 * @param {{ brand?: boolean }} [opts] brand: also read the page's brand
 *   signals (logo, colours — brandExtractor.js); crawlSite asks for the start page only
 * @returns {{ title: string, markdown: string, links: Array<{href:string,text:string}>, wordCount: number, brandSignals?: object }}
 */
function extractPage(html, pageUrl, { brand = false } = {}) {
  const $ = cheerio.load(html);

  // Before any stripping: the logo lives in exactly the header/nav removed below.
  const brandSignals = brand ? extractBrandSignals($, pageUrl.toString()) : null;

  // Links must be collected BEFORE stripping nav/header/footer — that's
  // exactly where a site's own navigation (and therefore the About/Pricing/
  // FAQ links this crawler is prioritizing) actually lives. Content
  // extraction below still runs on the stripped tree so chrome never ends
  // up in a saved document's text.
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = cleanText($(el).text());
    if (href) links.push({ href, text });
  });

  $(STRIP_SELECTORS).remove();
  $('*')
    .contents()
    .filter(function filterComments() { return this.type === 'comment'; })
    .remove();
  // .text() concatenates across <br> with no separator ("Take 2 capsules<br>
  // with food" -> "capsuleswith"), which breaks lexical-search tokens.
  $('br').replaceWith(' ');

  const pageTitle =
    cleanText($('title').first().text()) || cleanText($('h1').first().text()) || pageUrl.pathname || pageUrl.hostname;

  // Scope the h1-h3/p/li walk to the first main-content selector that
  // yields real content on THIS page, rather than always walking the whole
  // (stripped) <body> — a template-heavy e-commerce page routinely has promo
  // rails, "related products," and recommendation widgets that survive
  // STRIP_SELECTORS because they're not semantically chrome, just not the
  // content this page is actually about.
  let markdown = '';
  for (const selector of PREFERRED_CONTAINERS) {
    const $all = $(selector);
    if (!$all.length) continue;
    // EVERY occurrence, not just the first. A collections page or blog index
    // is routinely one <article> per card — the default card markup in several
    // major storefront themes — and scoping to the first match would keep one
    // product and silently drop the rest of the grid, which is the opposite of
    // what this pass is for. Nested matches are excluded so a container inside
    // another match isn't walked, and its text emitted, twice.
    const $found = $all.filter((_, el) => $(el).parents(selector).length === 0);
    const scoped = sectionsToMarkdown($, $found);
    if (countWords(scoped) >= MIN_WORDS_PER_PAGE) {
      markdown = scoped;
      break;
    }
  }
  // Default: the entire stripped <body>. No word-count gate here — a short
  // product/spec page is still real content and must not be dropped.
  if (!markdown) markdown = sectionsToMarkdown($, $('body'));

  const wordCount = countWords(markdown);
  // Link density = discovered links per content word. A thin index/listing page
  // (lots of links, little prose) scores high; a real content page scores low.
  const linkDensity = links.length / Math.max(1, wordCount);
  return { title: pageTitle, markdown, links, wordCount, linkDensity, ...(brandSignals ? { brandSignals } : {}) };
}

function countWords(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

// Every h1-h6 becomes a "## " heading, not #/###/… — parseIntoChunks splits
// only on "## ", so preserving the source's heading depth would fold every
// deeper heading (typically "Ingredients", "Directions", one FAQ question)
// into its parent's chunk instead of making it independently retrievable.
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// Elements whose own inline text is one unit of content. Their text is emitted
// once; nested BLOCK children are visited separately so nothing doubles.
const TEXT_BLOCK_TAGS = new Set(['p', 'li', 'dt', 'dd', 'td', 'th', 'blockquote', 'figcaption', 'caption']);
// Everything that counts as a "block" for nesting decisions (used to split a
// container's own text from its descendants').
const BLOCK_TAGS = new Set([
  'p', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption',
  'blockquote', 'caption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
]);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',');

function sectionsToMarkdown($, $root) {
  const sections = [];
  let current = null;

  const ensureSection = () => { if (!current) current = { heading: 'Overview', blocks: [] }; };
  const pushText = (text, prefix = '') => {
    const clean = cleanText(text);
    if (!clean || isBoilerplateLine(clean)) return;
    ensureSection();
    current.blocks.push(prefix + clean);
  };
  // A pre-formatted multi-line block (a Markdown table) — kept verbatim, not
  // run through cleanText (which would collapse its newlines into one line).
  const pushRaw = (block) => {
    if (!block) return;
    ensureSection();
    current.blocks.push(block);
  };
  const startSection = (text) => {
    const heading = cleanText(text);
    if (!heading || isBoilerplateLine(heading)) return; // e.g. a stray "Search"/"Menu" widget heading
    if (current && current.blocks.length) sections.push(current);
    current = { heading, blocks: [] };
  };

  // An element's own inline text, with nested block descendants removed so
  // they aren't counted here AND again when they're walked.
  const ownInlineText = ($el) => $el.clone().find(BLOCK_SELECTOR).remove().end().text();
  const hasBlockDescendant = ($el) => $el.find(BLOCK_SELECTOR).length > 0;
  const isBlock = (node) => node.type === 'tag' && BLOCK_TAGS.has(node.name);

  // <table> -> a GFM Markdown table (first row as header). Critical for
  // pricing tiers, specs and data sheets, which carry their meaning in the
  // row/column structure, not in prose.
  const renderTable = ($t) => {
    const caption = cleanText($t.children('caption').first().text());
    if (caption) pushText(caption);
    const rows = [];
    $t.find('tr').each((_, tr) => {
      const $tr = $(tr);
      if ($tr.closest('table').get(0) !== $t.get(0)) return; // skip a nested table's rows
      const cells = $tr.children('td, th')
        .map((_, c) => cleanText($(c).text()).replace(/\|/g, '\\|')).get();
      if (cells.some((c) => c !== '')) rows.push(cells);
    });
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const pad = (r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c; };
    const header = pad(rows[0]);
    const lines = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`)
    ];
    pushRaw(lines.join('\n'));
  };

  const walk = (node) => {
    if (!node || node.type !== 'tag') return;
    const tag = node.name;
    const $el = $(node);
    if (HEADING_TAGS.has(tag)) { startSection($el.text()); return; }
    if (tag === 'table') { renderTable($el); return; }
    if (TEXT_BLOCK_TAGS.has(tag)) {
      const prefix = tag === 'li' || tag === 'dd' ? '- ' : '';
      pushText(ownInlineText($el), prefix);
      // Descend only into nested BLOCK children (e.g. <li><p>…</p>, a sub-list,
      // an FAQ <li><h3>Q</h3><p>A</p></li>); inline children were in ownText.
      (node.children || []).forEach((c) => { if (isBlock(c)) walk(c); });
      return;
    }
    // Generic container (div/section/span/…). If it holds no block descendant,
    // it's a leaf whose full inline text is captured once (keeps a price span
    // with its label). Otherwise emit only its loose direct text and recurse.
    if (!hasBlockDescendant($el)) { pushText($el.text()); return; }
    (node.children || []).forEach((c) => {
      if (c.type === 'text') pushText($(c).text());
      else walk(c);
    });
  };

  $root.each((_, el) => (el.children || []).forEach(walk));
  if (current && current.blocks.length) sections.push(current);

  return sections.map((s) => `## ${s.heading}\n\n${s.blocks.join('\n\n')}`).join('\n\n');
}

function linkPriority(urlObj, href, text) {
  if (isFocusPath(urlObj)) return 2; // content directories (/products/, /collections/, …) first
  const hay = `${href} ${text}`.toLowerCase();
  return PRIORITY_KEYWORDS.some((kw) => hay.includes(kw)) ? 1 : 0;
}

// Tier 1 save gate: is an extracted page worth keeping as a document? A
// focus-directory page is judged leniently (short product/course pages count);
// everything else must clear the content-word floor and not be a link-heavy
// thin index page. Following a page's links is decided separately, so a thin
// listing page is still mined for the product links it points to.
function passesQuality(page, urlObj) {
  if (isFocusPath(urlObj)) return page.wordCount >= MIN_WORDS_PER_PAGE;
  if (page.wordCount < MIN_CONTENT_WORDS) return false;
  if (page.linkDensity > MAX_LINK_RATIO) return false;
  return true;
}

// Dedup key for the visited/queued sets: strip the hash and query string
// (marketing-site query strings are almost always tracking params, not
// distinct content) and a trailing slash.
function dedupeKey(urlObj) {
  const clone = new URL(urlObj.toString());
  clone.hash = '';
  clone.search = '';
  let s = clone.toString();
  if (s.endsWith('/') && s.length > 1) s = s.slice(0, -1);
  return s;
}

// ---------------------------------------------------------------------
// Crawl orchestration: a small priority-ordered BFS, bounded by page count,
// depth, and a wall-clock time budget (whichever comes first), with limited
// concurrency so it stays polite to the target site.
//
// Two tiers per page:
//   Tier 1 (always): fetchSafe + cheerio — fast, handles most sites.
//   Tier 2 (opt-in via browserFallback): headless Chromium
//     (crawlerBrowser.js), tried for a page when Tier 1 yields an empty
//     shell (< MIN_WORDS_PER_PAGE words — a JS-only SPA) or is blocked
//     (BROWSER_RETRY_STATUSES). Once a render beats the static result, the
//     rest of that crawl renders directly (the site is evidently an SPA —
//     no point fetching every page twice). A 404, a non-HTML page, or an
//     SSRF refusal never triggers Tier 2.
// ---------------------------------------------------------------------

// Statuses that usually mean "not for plain HTTP clients" rather than "not
// here": bot walls, WAF challenges, rate limits.
const BROWSER_RETRY_STATUSES = new Set([401, 403, 406, 429, 503]);
const MAX_RENDERS_PER_CRAWL = envInt('CRAWLER_MAX_RENDERS', 8);
const BROWSER_TOTAL_BUDGET_MS = envInt('CRAWLER_BROWSER_BUDGET_MS', 120000); // renders take seconds each, not milliseconds

// "acme.com" and "www.acme.com" are the same site. Comparing exact
// hostnames made an apex->www redirect (very common) discard every link the
// homepage had, crawling one page; it also now lets a final URL be checked
// against the site after redirects (a same-site link that redirects to
// another domain is dropped, not saved).
function siteKey(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * @param {string} baseUrlString
 * @param {{
 *   maxPages?: number, maxDepth?: number,
 *   browserFallback?: boolean,
 *   renderer?: (url: string, opts: { checkHost: Function, timeoutMs: number }) => Promise<{ html: string, finalUrl: URL } | null>
 * }} [opts]
 *   browserFallback: enable Tier 2. OFF by default — see crawlerBrowser.js
 *     for why only the operator scrape route turns it on.
 *   renderer: override Tier 2's renderer (tests); defaults to crawlerBrowser.renderPage.
 * @returns {Promise<{
 *   pages: Array<{ title: string, markdown: string, url: string, rendered: boolean }>,
 *   crawled: number, skipped: number, rendered: number, baseHost: string
 * }>}
 */
const PDF_HINT = 'Upload a PDF of the content or add it as a document instead.';

/**
 * The user-facing reason a crawl found nothing, from what happened to its
 * start page. Pure, so it's tested directly.
 * @param {string} host
 * @param {{ failure?: { httpStatus?: number, kind?: string } | null, outcome?: 'thin'|'offsite'|null, usedBrowser?: boolean }} info
 */
function describeStartFailure(host, { failure = null, outcome = null, usedBrowser = false } = {}) {
  const status = failure?.httpStatus;
  if (status === 429) return `${host} is limiting automated requests right now (HTTP 429). Try again in a few minutes. ${PDF_HINT}`;
  if ([401, 403, 406, 503].includes(status)) return `${host} blocks automated readers (HTTP ${status}), so its pages can't be imported. ${PDF_HINT}`;
  if (status === 404 || status === 410) return `That page wasn't found on ${host} (HTTP ${status}). Check the address and try again.`;
  if (status >= 500) return `${host} returned a server error (HTTP ${status}). Try again later. ${PDF_HINT}`;
  if (failure?.kind === 'timeout') return `${host} took too long to respond. Try again later. ${PDF_HINT}`;
  if (failure?.kind === 'unreachable') return `Couldn't connect to ${host}. Check the address and try again. ${PDF_HINT}`;
  if (outcome === 'offsite') return `${host} redirects to a different website, so there was nothing on it to import. Enter the address it redirects to instead.`;
  if (outcome === 'thin' && !usedBrowser) {
    return `${host} builds its pages with JavaScript, so there was no readable text to import. ${PDF_HINT}`;
  }
  return `No readable content could be extracted from ${host}. ${PDF_HINT}`;
}

async function crawlSite(baseUrlString, opts = {}) {
  const maxPages = Math.max(1, Math.min(opts.maxPages || MAX_PAGES, MAX_PAGES));
  const maxDepth = Math.max(0, Math.min(opts.maxDepth ?? MAX_DEPTH, MAX_DEPTH));

  const base = assertHttpUrl(baseUrlString);
  await assertPublicHost(base.hostname);

  let renderer = null;
  if (opts.browserFallback) {
    if (opts.renderer) renderer = opts.renderer;
    else {
      const browserTier = require('./crawlerBrowser');
      if (browserTier.isBrowserAvailable()) renderer = browserTier.renderPage;
    }
  }

  const deadline = Date.now() + (renderer ? BROWSER_TOTAL_BUDGET_MS : TOTAL_BUDGET_MS);
  const visited = new Set();
  const savedUrls = new Set();
  const queued = new Set([dedupeKey(base)]);
  let queue = [{ url: base, depth: 0, priority: 1 }];

  const pages = [];
  let skipped = 0;
  let rendersStarted = 0;
  let renderedCount = 0;
  let preferBrowser = false;

  const sameSite = (urlObj) => siteKey(urlObj.hostname) === siteKey(base.hostname);

  // Why the start page gave nothing, for the error if the whole crawl does.
  let startFailure = null; // the CrawlerError from fetching it
  let startOutcome = null; // 'thin' | 'offsite' when it loaded but couldn't be used
  let startBrand = null; // the start page's brand signals (logo, colours), when it loaded on-site

  // The start page gets one retry after a dropped connection or a gateway
  // error (a cold server, a CDN hiccup): it's the one page every crawl needs.
  async function fetchPage(item) {
    try {
      return await fetchSafe(item.url.toString());
    } catch (err) {
      const transient = err.kind === 'unreachable' || err.httpStatus === 502 || err.httpStatus === 504;
      if (item.depth !== 0 || !transient || deadline - Date.now() < PER_REQUEST_TIMEOUT_MS) throw err;
      return fetchSafe(item.url.toString());
    }
  }

  async function tryRender(item) {
    if (!renderer || rendersStarted >= MAX_RENDERS_PER_CRAWL) return null;
    const timeoutMs = Math.min(15000, deadline - Date.now());
    if (timeoutMs < 2000) return null; // not enough budget left for a meaningful render
    rendersStarted += 1;
    try {
      const rendered = await renderer(item.url.toString(), { checkHost: assertPublicHost, timeoutMs });
      if (!rendered || !sameSite(rendered.finalUrl)) return null; // non-HTML, or client-side nav off-site
      const page = extractPage(rendered.html, rendered.finalUrl, { brand: item.depth === 0 });
      return { item, page, finalUrl: rendered.finalUrl, rendered: true };
    } catch {
      return null;
    }
  }

  async function processItem(item) {
    // SPA already detected: render first, and only fall back to a static
    // fetch if the render fails, is thin, or the render cap is spent.
    let renderedResult = null;
    if (preferBrowser) {
      renderedResult = await tryRender(item);
      if (renderedResult && renderedResult.page.wordCount >= MIN_WORDS_PER_PAGE) return renderedResult;
    }

    let staticResult = null;
    try {
      const fetched = await fetchPage(item);
      if (!fetched) return null; // non-HTML content-type — a browser won't make it a page
      const page = extractPage(fetched.html, fetched.finalUrl, { brand: item.depth === 0 });
      staticResult = { item, page, finalUrl: fetched.finalUrl, rendered: false };
    } catch (err) {
      if (item.depth === 0) startFailure = err;
      // Only an HTTP-level block is worth a browser retry; SSRF refusals,
      // DNS failures, 404s and timeouts are not.
      if (!BROWSER_RETRY_STATUSES.has(err.httpStatus)) return renderedResult;
    }
    if (staticResult && staticResult.page.wordCount >= MIN_WORDS_PER_PAGE) return staticResult;

    if (!preferBrowser) renderedResult = await tryRender(item); // never render the same page twice
    if (renderedResult && renderedResult.page.wordCount > (staticResult?.page.wordCount ?? -1)) {
      if (renderedResult.page.wordCount >= MIN_WORDS_PER_PAGE) preferBrowser = true;
      return renderedResult;
    }
    return staticResult; // may be a thin page (counted as skipped below) or null
  }

  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    queue.sort((a, b) => b.priority - a.priority);
    const batch = queue.splice(0, CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (item) => {
        const key = dedupeKey(item.url);
        if (visited.has(key)) return null;
        visited.add(key);
        try {
          return await processItem(item);
        } catch {
          return null; // one bad page must never abort the whole crawl
        }
      })
    );

    for (const result of results) {
      // Enforced per-result, not just once per outer loop iteration: a
      // single concurrent batch (up to CONCURRENCY items) can otherwise
      // overshoot maxPages, since results only become available together
      // after the whole batch settles. Results are still in priority order
      // (Promise.all preserves the sorted batch's order), so this is also
      // what makes the priority sort meaningfully decide which pages survive
      // when the budget runs out mid-batch, not just which are fetched first.
      if (pages.length >= maxPages) break;

      if (!result) {
        skipped += 1;
        continue;
      }
      const { item, page, finalUrl, rendered } = result;
      // Kept even when the start page is too thin to save: a JS-only shell
      // still carries the logo and the theme-color meta.
      if (item.depth === 0 && page.brandSignals && sameSite(finalUrl)) startBrand = page.brandSignals;

      // After redirects (HTTP or client-side), the page must still be on
      // this site, and not a page already saved under another link (e.g.
      // "/" and "/en" both landing on "/en").
      if (!sameSite(finalUrl) || savedUrls.has(dedupeKey(finalUrl))) {
        if (item.depth === 0 && !sameSite(finalUrl)) startOutcome = 'offsite';
        skipped += 1;
        continue;
      }

      if (passesQuality(page, finalUrl)) {
        savedUrls.add(dedupeKey(finalUrl));
        pages.push({ title: page.title, markdown: page.markdown, url: finalUrl.toString(), rendered });
        if (rendered) renderedCount += 1;
      } else {
        // A start page below the thin-shell floor is reported as 'thin' (its
        // own content is unusable); otherwise it's just a low-quality page
        // skipped from saving — its links are still mined below.
        if (item.depth === 0 && page.wordCount < MIN_WORDS_PER_PAGE) startOutcome = 'thin';
        skipped += 1;
      }

      if (pages.length >= maxPages) continue; // budget just filled — don't discover more links from this page
      if (item.depth >= maxDepth) continue;
      for (const link of page.links) {
        let resolved;
        try {
          resolved = new URL(link.href, finalUrl);
        } catch {
          continue;
        }
        if (!sameSite(resolved)) continue; // same-site only (www. and apex count as one) — the hard requirement
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
        if (isNoisyPath(resolved)) continue; // Tier 1: never fetch carts/logins/search/pagination
        const linkKey = dedupeKey(resolved);
        if (queued.has(linkKey)) continue;
        queued.add(linkKey);
        queue.push({ url: resolved, depth: item.depth + 1, priority: linkPriority(resolved, link.href, link.text) });
      }
    }
  }

  if (!pages.length) {
    throw new CrawlerError(
      describeStartFailure(base.hostname, { failure: startFailure, outcome: startOutcome, usedBrowser: !!renderer }),
      422
    );
  }

  // Best-effort: a brand that can't be read is null, never a failed crawl.
  let brand = null;
  if (startBrand && opts.extractBrand !== false) {
    brand = await resolveSiteBrand(startBrand).catch(() => null);
  }

  return { pages, crawled: pages.length, skipped, rendered: renderedCount, baseHost: base.hostname, brand };
}

// ---------------------------------------------------------------------
// Brand kit (Bot Branding & Theme Studio, services/branding.js).
// ---------------------------------------------------------------------

const BRAND_CSS_TIMEOUT_MS = 4000;
const BRAND_CSS_MAX_BYTES = 400 * 1024;
const LOGO_MAX_BYTES = 1536 * 1024;

/**
 * Download a logo (SSRF-guarded, size-capped) and describe how it looks —
 * logoAnalyzer.js. Never throws: an unreachable or unreadable logo is null.
 * @param {string|null} url
 */
/** A logo image's bytes, through the same SSRF guards as a crawl; null on any failure. */
async function fetchLogoImage(url) {
  if (!url) return null;
  const fetched = await fetchSafe(url, {
    timeoutMs: BRAND_CSS_TIMEOUT_MS, accept: isImage, maxBytes: LOGO_MAX_BYTES, responseType: 'buffer'
  }).catch(() => null);
  return fetched ? fetched.body : null;
}

async function analyzeLogoUrl(url) {
  const bytes = await fetchLogoImage(url);
  return bytes ? analyzeLogo(bytes) : null;
}

// The start page's own signals plus up to three linked stylesheets and the
// logo image, all fetched in parallel through fetchSafe so the SSRF guards
// apply to them too. Anything that fails or is too large is simply skipped.
async function resolveSiteBrand(signals) {
  const [sheets, logoAppearance] = await Promise.all([
    Promise.all(
      (signals.stylesheetUrls || []).map((url) =>
        fetchSafe(url, { timeoutMs: BRAND_CSS_TIMEOUT_MS, accept: isCss, maxBytes: BRAND_CSS_MAX_BYTES })
          .then((r) => (r ? r.html : ''), () => ''))
    ),
    analyzeLogoUrl(signals.logoUrl)
  ]);
  return { ...resolveBrand(signals, sheets.filter(Boolean)), logoAppearance };
}

/**
 * The brand kit for one site without crawling it — its homepage's logo and
 * colours. Backs the Theme Studio's "Rescan website"; same SSRF guards as a crawl.
 * @param {string} urlString
 * @returns {Promise<ReturnType<typeof resolveBrand>>}
 * @throws {CrawlerError} when the address is unsafe, unreachable or not a web page
 */
async function scanBrand(urlString) {
  const fetched = await fetchSafe(assertHttpUrl(urlString).toString());
  if (!fetched) throw new CrawlerError('That address did not return a web page', 422);
  const $ = cheerio.load(fetched.html);
  return resolveSiteBrand(extractBrandSignals($, fetched.finalUrl.toString()));
}

module.exports = {
  crawlSite, scanBrand, analyzeLogoUrl, fetchLogoImage, fetchSafe, readBody, MAX_HTML_BYTES, CrawlerError, extractPage, isPrivateIPv4, isPrivateIPv6,
  isBoilerplateLine, assertPublicHost, describeStartFailure, isNoisyPath, isFocusPath, passesQuality, MIN_WORDS_PER_PAGE
};
