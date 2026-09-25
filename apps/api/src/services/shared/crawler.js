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

const MAX_PAGES = 12;
const MAX_DEPTH = 2;
const PER_REQUEST_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 30000;
const CONCURRENCY = 3;
const MAX_REDIRECTS = 3;
const MIN_WORDS_PER_PAGE = 30; // below this, treat as a stub/redirect page, not real content
const USER_AGENT = 'FlatbrizTenantOnboardingBot/1.0 (+https://flatbriz.example/bot)';

// Same-domain links whose href/anchor text mention these are crawled before
// any other discovered link — the pages the prospect's admin actually wants
// trained on, per the feature request (About/FAQ/Support/Pricing).
const PRIORITY_KEYWORDS = ['about', 'faq', 'pricing', 'plans', 'support', 'help', 'contact', 'service', 'feature'];

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
  '.search-bar', '.breadcrumb', '.breadcrumbs', '.sidebar', '.menu', '.dropdown'
].join(',');

// UI labels/boilerplate that sometimes survive element-level stripping
// (e.g. a "Your cart is empty" message rendered as a <p> inside a div that
// isn't itself matched by STRIP_SELECTORS). Two tiers, deliberately kept
// separate: EXACT entries only match a line that, once trimmed, is nothing
// but the label itself — a real sentence that happens to contain the word
// "menu" or "search" (e.g. "See our full menu of services") must not be
// dropped, so these never match as a substring. SUBSTRING entries are
// multi-word phrases distinctive enough that a substring match anywhere in
// the line is safe — but only on a short, UI-snippet-sized line: a real FAQ
// answer like "Click Add to Cart, then check out..." or "Refunds are covered
// by our terms of service..." is exactly the content the bots need, and it
// would otherwise be dropped for mentioning the phrase.
const BOILERPLATE_EXACT = new Set([
  'menu', 'search', 'cart', 'my account', 'account', 'wishlist', 'compare',
  'sign in', 'log in', 'login', 'sign up', 'register', 'home', 'close',
  'skip to content', 'skip to main content', 'back to top', 'read more'
]);

const BOILERPLATE_SUBSTRINGS = [
  'your cart is empty', 'all rights reserved', 'cookie policy', 'privacy policy',
  'terms of service', 'terms and conditions', 'we use cookies', 'accept cookies',
  'subscribe to our newsletter', 'follow us on', 'added to cart', 'add to cart',
  'out of stock', 'in stock', 'free shipping on orders'
];

const BOILERPLATE_SUBSTRING_MAX_WORDS = 15;

function isBoilerplateLine(text) {
  const clean = text.trim().toLowerCase();
  if (!clean) return true;
  if (BOILERPLATE_EXACT.has(clean)) return true;
  if (clean.split(/\s+/).length > BOILERPLATE_SUBSTRING_MAX_WORDS) return false;
  return BOILERPLATE_SUBSTRINGS.some((phrase) => clean.includes(phrase));
}

// Tried in this order; the first one that yields at least MIN_WORDS_PER_PAGE
// of content scopes extraction, else <body> — a real content wrapper is
// almost always a more precise signal than "everything STRIP_SELECTORS
// didn't remove from <body>," especially on a template-heavy e-commerce page
// with several still-unstripped promo rails sitting alongside the actual
// content. The word floor matters: a JS-hydrated storefront often ships an
// empty <main id="app"> shell with the server-rendered content elsewhere.
// Bare `section` is last because it's the weakest signal — without a
// <main>/<article>, the first <section> on a page is as likely a promo
// banner as the product copy.
const MAIN_CONTENT_SELECTORS = [
  'main', 'article',
  '.product-description', '.faq-content', '.content-body', '#content',
  'section'
];

class CrawlerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CrawlerError';
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------
// SSRF safety. This endpoint is super-admin-only, but it's still a server
// making requests to a URL an admin typed in — the same category of risk as
// any "fetch this URL for me" feature. Block loopback/private/link-local
// targets (including the 169.254.169.254 cloud-metadata address) and
// re-validate on every redirect hop, since a public hostname can still
// redirect to an internal address.
// ---------------------------------------------------------------------

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // malformed -> treat as unsafe
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:')) return true; // link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true; // fc00::/7 unique local
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.split(':').pop();
    if (mapped && mapped.includes('.')) return isPrivateIPv4(mapped); // IPv4-mapped
  }
  return false;
}

async function assertPublicHost(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new CrawlerError(`Could not resolve "${hostname}"`, 400);
  }
  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) {
      throw new CrawlerError(`"${hostname}" resolves to a non-public address — refusing to crawl it`, 400);
    }
  }
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

async function fetchSafe(urlString, { timeoutMs = PER_REQUEST_TIMEOUT_MS } = {}) {
  let current = assertHttpUrl(urlString);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }
      });
    } catch (err) {
      throw new CrawlerError(`Could not reach ${current.hostname}: ${err.message}`, 502);
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new CrawlerError(`Redirect from ${current} had no Location header`, 502);
      current = new URL(location, current);
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw new CrawlerError('Refusing to follow a redirect to a non-http(s) URL', 400);
      }
      continue;
    }

    if (!res.ok) {
      const err = new CrawlerError(`${current} returned HTTP ${res.status}`, 502);
      err.httpStatus = res.status; // lets crawlSite tell "blocked" (403) from "missing" (404)
      throw err;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) return null; // PDF/image/etc. — caller skips it

    const html = await res.text();
    return { html, finalUrl: current };
  }

  throw new CrawlerError('Too many redirects', 502);
}

// ---------------------------------------------------------------------
// HTML -> structured markdown. Deliberately simple: only h1-h3/p/li carry
// content (no generic div/span text-node scraping — that pulls in far more
// layout noise than prose on most real marketing sites).
// ---------------------------------------------------------------------

function cleanText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} html
 * @param {URL} pageUrl
 * @returns {{ title: string, markdown: string, links: Array<{href:string,text:string}>, wordCount: number }}
 */
function extractPage(html, pageUrl) {
  const $ = cheerio.load(html);

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
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const $found = $(selector);
    if (!$found.length) continue;
    const scoped = sectionsToMarkdown($, $found);
    if (countWords(scoped) >= MIN_WORDS_PER_PAGE) {
      markdown = scoped;
      break;
    }
  }
  if (!markdown) markdown = sectionsToMarkdown($, $('body'));

  return { title: pageTitle, markdown, links, wordCount: countWords(markdown) };
}

function countWords(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

// Every h1-h3 becomes a "## " heading, not #/### — parseIntoChunks splits
// only on "## ", so preserving the source's heading depth would fold every
// h3 (typically "Ingredients", "Directions", one FAQ question) into its
// parent h2's chunk instead of making it independently retrievable.
function sectionsToMarkdown($, $root) {
  const sections = [];
  let current = null;
  const pushText = (text, prefix = '') => {
    const clean = cleanText(text);
    if (!clean || isBoilerplateLine(clean)) return;
    if (!current) current = { heading: 'Overview', paragraphs: [] };
    current.paragraphs.push(prefix + clean);
  };

  $root
    .find('h1, h2, h3, p, li')
    .each((_, el) => {
      const $el = $(el);
      const tag = el.name;
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const heading = cleanText($el.text());
        if (!heading || isBoilerplateLine(heading)) return; // e.g. a stray "Search" or "Menu" widget heading
        if (current && current.paragraphs.length) sections.push(current);
        current = { heading, paragraphs: [] };
      } else if (tag === 'p') {
        pushText($el.text());
      } else if (tag === 'li') {
        // Drop nested lists, headings, and paragraphs — each is walked on
        // its own. Otherwise an FAQ accordion's <li><h3>Q</h3><p>A</p></li>
        // is emitted twice: once as the <li>'s run-together text, and again
        // as its own heading + paragraph.
        const ownText = $el.clone().find('ul, ol, h1, h2, h3, p').remove().end().text();
        pushText(ownText, '- ');
      }
    });
  if (current && current.paragraphs.length) sections.push(current);

  return sections.map((s) => `## ${s.heading}\n\n${s.paragraphs.join('\n\n')}`).join('\n\n');
}

function linkPriority(href, text) {
  const hay = `${href} ${text}`.toLowerCase();
  return PRIORITY_KEYWORDS.some((kw) => hay.includes(kw)) ? 1 : 0;
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
const MAX_RENDERS_PER_CRAWL = 8;
const BROWSER_TOTAL_BUDGET_MS = 60000; // renders take seconds each, not milliseconds

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
 *     for why only the super-admin scrape route turns it on.
 *   renderer: override Tier 2's renderer (tests); defaults to crawlerBrowser.renderPage.
 * @returns {Promise<{
 *   pages: Array<{ title: string, markdown: string, url: string, rendered: boolean }>,
 *   crawled: number, skipped: number, rendered: number, baseHost: string
 * }>}
 */
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

  async function tryRender(item) {
    if (!renderer || rendersStarted >= MAX_RENDERS_PER_CRAWL) return null;
    const timeoutMs = Math.min(15000, deadline - Date.now());
    if (timeoutMs < 2000) return null; // not enough budget left for a meaningful render
    rendersStarted += 1;
    try {
      const rendered = await renderer(item.url.toString(), { checkHost: assertPublicHost, timeoutMs });
      if (!rendered || !sameSite(rendered.finalUrl)) return null; // non-HTML, or client-side nav off-site
      return { item, page: extractPage(rendered.html, rendered.finalUrl), finalUrl: rendered.finalUrl, rendered: true };
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
      const fetched = await fetchSafe(item.url.toString());
      if (!fetched) return null; // non-HTML content-type — a browser won't make it a page
      staticResult = { item, page: extractPage(fetched.html, fetched.finalUrl), finalUrl: fetched.finalUrl, rendered: false };
    } catch (err) {
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

      // After redirects (HTTP or client-side), the page must still be on
      // this site, and not a page already saved under another link (e.g.
      // "/" and "/en" both landing on "/en").
      if (!sameSite(finalUrl) || savedUrls.has(dedupeKey(finalUrl))) {
        skipped += 1;
        continue;
      }

      if (page.wordCount >= MIN_WORDS_PER_PAGE) {
        savedUrls.add(dedupeKey(finalUrl));
        pages.push({ title: page.title, markdown: page.markdown, url: finalUrl.toString(), rendered });
        if (rendered) renderedCount += 1;
      } else {
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
        const linkKey = dedupeKey(resolved);
        if (queued.has(linkKey)) continue;
        queued.add(linkKey);
        queue.push({ url: resolved, depth: item.depth + 1, priority: linkPriority(link.href, link.text) });
      }
    }
  }

  if (!pages.length) {
    throw new CrawlerError('No readable content could be extracted from that site', 422);
  }

  return { pages, crawled: pages.length, skipped, rendered: renderedCount, baseHost: base.hostname };
}

module.exports = {
  crawlSite, CrawlerError, extractPage, isPrivateIPv4, isPrivateIPv6, isBoilerplateLine, assertPublicHost, MIN_WORDS_PER_PAGE
};
