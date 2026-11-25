// Full-site discovery from a site's sitemap(s) — the breadth layer under the
// single-URL/BFS crawler.js. Given a site address it finds the pages the site
// itself advertises: robots.txt `Sitemap:` directives first, then the
// conventional /sitemap.xml, following <sitemapindex> children one level deep.
//
// Every fetch goes through crawler.fetchSafe, so the SAME SSRF defences apply as
// to a normal crawl — DNS re-validated and pinned on every hop, private/
// loopback/metadata addresses refused, redirects re-checked, bodies size-capped.
// Results are scoped to the start site (apex and www. count as one, exactly like
// crawler.siteKey) and hard-capped, so a hostile or enormous sitemap can't fan
// the crawler out across the internet or exhaust it.
//
// Pure parsing (parseSitemapXml, sameSite) is separated from I/O so it is tested
// directly, and the network layer is injectable (deps.fetchText) for tests.

const { URL } = require('url');
const { fetchSafe, CrawlerError } = require('./crawler');

const envInt = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};

const MAX_URLS = envInt('SITEMAP_MAX_URLS', 500);        // pages taken from all sitemaps combined
const MAX_SITEMAPS = envInt('SITEMAP_MAX_FILES', 50);    // sitemap documents fetched (index + children)
const MAX_XML_BYTES = 10 * 1024 * 1024;                   // one sitemap document
const MAX_ROBOTS_BYTES = 512 * 1024;

const isXml = (ct) => /xml/i.test(ct) || /text\/plain/i.test(ct);
const isText = (ct) => /text\//i.test(ct) || /xml/i.test(ct);

// Same normalisation crawler.siteKey uses: apex and www. are one site.
function siteKey(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

/**
 * Parse a sitemap document. Returns the child sitemaps it points to (when it is
 * a <sitemapindex>) and the page URLs it lists (when it is a <urlset>). Robust to
 * either shape appearing, to namespaced/намespaced tags, and to junk: a <loc>
 * that isn't a valid absolute http(s) URL is dropped.
 * @param {string} xml
 * @returns {{ sitemaps: string[], urls: string[] }}
 */
function parseSitemapXml(xml) {
  const text = String(xml || '');
  const sitemaps = [];
  const urls = [];
  // <sitemap>…<loc>X</loc>…</sitemap> blocks are child sitemaps; every other
  // <loc> is a page. Tag matching ignores namespace prefixes (e.g. <ns:loc>).
  const blockRe = /<(?:\w+:)?sitemap\b[\s\S]*?<\/(?:\w+:)?sitemap>/gi;
  const indexLocs = new Set();
  let block;
  while ((block = blockRe.exec(text)) !== null) {
    const loc = /<(?:\w+:)?loc>\s*([\s\S]*?)\s*<\/(?:\w+:)?loc>/i.exec(block[0]);
    if (loc) { const u = cleanLoc(loc[1]); if (u) { sitemaps.push(u); indexLocs.add(u); } }
  }
  const locRe = /<(?:\w+:)?loc>\s*([\s\S]*?)\s*<\/(?:\w+:)?loc>/gi;
  let m;
  while ((m = locRe.exec(text)) !== null) {
    const u = cleanLoc(m[1]);
    if (u && !indexLocs.has(u)) urls.push(u);
  }
  return { sitemaps: dedupe(sitemaps), urls: dedupe(urls) };
}

function cleanLoc(raw) {
  const s = String(raw || '').trim()
    .replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function dedupe(arr) {
  return [...new Set(arr)];
}

/** `Sitemap:` directives from a robots.txt body (case-insensitive, one per line). */
function parseRobotsSitemaps(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m) { const u = cleanLoc(m[1]); if (u) out.push(u); }
  }
  return dedupe(out);
}

// Default network layer: crawler.fetchSafe (SSRF-guarded), returning body text or
// null (non-text content / refused). Injectable for tests.
async function defaultFetchText(url, { maxBytes, accept } = {}) {
  const res = await fetchSafe(url, { accept, maxBytes }).catch((err) => {
    if (err instanceof CrawlerError) return null; // unreachable / blocked / SSRF — treat as "no sitemap here"
    throw err;
  });
  return res ? res.html : null;
}

/**
 * Discover and collect the page URLs a site advertises via its sitemap(s).
 * Same-site only, de-duplicated and capped at MAX_URLS.
 * @param {string} siteUrl a page or origin on the target site
 * @param {{ fetchText?: Function, maxUrls?: number, maxSitemaps?: number }} [deps]
 * @returns {Promise<{ urls: string[], sitemaps: string[], baseHost: string, truncated: boolean }>}
 * @throws {CrawlerError} when the address itself is invalid/unsafe
 */
async function collectSitemapUrls(siteUrl, deps = {}) {
  const fetchText = deps.fetchText || defaultFetchText;
  const maxUrls = Math.max(1, Math.min(deps.maxUrls || MAX_URLS, MAX_URLS));
  const maxSitemaps = Math.max(1, Math.min(deps.maxSitemaps || MAX_SITEMAPS, MAX_SITEMAPS));

  let base;
  try {
    base = new URL(siteUrl);
  } catch {
    throw new CrawlerError('That is not a valid URL', 400);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new CrawlerError('Only http/https URLs are supported', 400);
  const baseHost = base.hostname;
  const sameSite = (u) => { try { return siteKey(new URL(u).hostname) === siteKey(baseHost); } catch { return false; } };

  // 1. Seed the queue: robots.txt directives, then the conventional /sitemap.xml.
  const robots = await fetchText(`${base.origin}/robots.txt`, { maxBytes: MAX_ROBOTS_BYTES, accept: isText }).catch(() => null);
  const seeds = parseRobotsSitemaps(robots);
  if (!seeds.includes(`${base.origin}/sitemap.xml`)) seeds.push(`${base.origin}/sitemap.xml`);

  const queue = seeds.filter(sameSite);
  const seenSitemaps = new Set(queue);
  const fetchedSitemaps = [];
  const urls = new Set();
  let truncated = false;

  while (queue.length && fetchedSitemaps.length < maxSitemaps) {
    const sm = queue.shift();
    const xml = await fetchText(sm, { maxBytes: MAX_XML_BYTES, accept: isXml }).catch(() => null);
    if (!xml) continue;
    fetchedSitemaps.push(sm);
    const { sitemaps, urls: pageUrls } = parseSitemapXml(xml);
    for (const child of sitemaps) {
      if (!sameSite(child) || seenSitemaps.has(child) || seenSitemaps.size >= maxSitemaps * 4) continue;
      seenSitemaps.add(child);
      queue.push(child);
    }
    for (const u of pageUrls) {
      if (!sameSite(u)) continue;
      if (urls.size >= maxUrls) { truncated = true; break; }
      urls.add(u);
    }
    if (urls.size >= maxUrls) { truncated = true; break; }
  }

  return { urls: [...urls], sitemaps: fetchedSitemaps, baseHost, truncated };
}

module.exports = {
  collectSitemapUrls,
  parseSitemapXml,
  parseRobotsSitemaps,
  cleanLoc,
  siteKey,
  MAX_URLS,
  MAX_SITEMAPS
};
