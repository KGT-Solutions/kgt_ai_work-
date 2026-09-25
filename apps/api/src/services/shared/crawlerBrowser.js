// Tier 2 of the crawler: a headless-Chromium renderer for pages the static
// fetch+cheerio path (crawler.js, Tier 1) can't read — JS-only SPAs that
// ship an empty <div id="root"></div>, and sites that 403 a plain HTTP
// client but serve a real browser. crawler.js decides WHEN to call this;
// this file only knows HOW to render one URL safely and return its HTML.
//
// ADMIN-ONLY BY DESIGN: Chromium is launched with --no-sandbox (the API
// container runs as root, where Chrome refuses to start sandboxed), so a
// renderer exploit on a hostile page would land in the API process's
// container. crawlSite only enables this tier when the caller passes
// browserFallback: true, and only the operator /tenants/:id/scrape route
// does — the public, unauthenticated /register/analyze route never renders.
//
// SSRF: Tier 1's checks cover the one URL it fetches, but a rendered page
// makes its OWN requests — scripts, XHR/fetch, iframes, redirects,
// WebSockets. Without a guard, a hostile page could fetch
// "http://127.0.0.1:4000/..." (the API's own CORS-enabled endpoints), write
// the response into its DOM, and have it scraped into a document. Two layers,
// both using the same public-address check (checkHost, injected by
// crawler.js):
//   1. Egress proxy (the real boundary): every render's browser context is
//      forced through a per-render HTTP proxy on loopback — including
//      loopback targets ("<-loopback>" removes Chrome's implicit bypass).
//      It checks every plain-HTTP request and every CONNECT tunnel (HTTPS
//      and WebSockets both use CONNECT). WebSockets are why this exists:
//      puppeteer request interception never sees them, and CDP
//      Network.setBlockedURLs was verified NOT to stop them (Chromium 149).
//   2. Request interception: aborts the same hosts earlier, and drops
//      images/fonts/media we never read.
// WebRTC is restricted to proxied UDP. Residual risk: DNS rebinding (the
// proxy re-resolves after checkHost) — same gap as Tier 1's fetchSafe.

const fs = require('fs');
const http = require('http');
const net = require('net');

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--mute-audio',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--force-webrtc-ip-handling-policy'
];

const DEFAULT_RENDER_TIMEOUT_MS = 15000;
const MAX_CONCURRENT_RENDERS = 2; // process-wide: each render is a Chromium tab (~50-150MB)
const IDLE_CLOSE_MS = 60000; // shut Chromium down after a quiet minute rather than idling in RAM
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const CONTENT_WAIT_WORDS = 30; // matches crawler.js MIN_WORDS_PER_PAGE
// Rendering only needs the DOM — skip the heavy bytes. Stylesheets and
// scripts still load: SPAs need their JS, and some gate rendering on CSS.
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

const EXECUTABLE_CANDIDATES = [
  '/usr/bin/chromium-browser', // Alpine (the production image)
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome'
];

function resolveExecutablePath() {
  const fromEnv = String(process.env.CRAWLER_BROWSER_PATH || '').trim();
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null;
  return EXECUTABLE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/** Tier 2 runs only when enabled (default on) AND a Chromium binary exists. */
function isBrowserAvailable() {
  if (String(process.env.CRAWLER_BROWSER_ENABLED || 'true').toLowerCase() === 'false') return false;
  return !!resolveExecutablePath();
}

// ---------------------------------------------------------------------
// One shared Chromium process, lazily launched, closed when idle. Each
// render gets its own browser context (separate cookies/storage/cache), so
// one tenant's crawl can never see another's session state.
// ---------------------------------------------------------------------

let browserPromise = null;
let idleTimer = null;
let activeRenders = 0;
const waiters = [];

function getBrowser() {
  if (!browserPromise) {
    const puppeteer = require('puppeteer-core');
    browserPromise = puppeteer
      .launch({ executablePath: resolveExecutablePath(), headless: true, args: LAUNCH_ARGS })
      .then((browser) => {
        browser.on('disconnected', () => { browserPromise = null; });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (activeRenders > 0 || !browserPromise) return;
    const pending = browserPromise;
    browserPromise = null;
    try { (await pending).close(); } catch { /* already gone */ }
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.(); // never keep the process (or the test runner) alive just for this
}

async function closeBrowser() {
  clearTimeout(idleTimer);
  const pending = browserPromise;
  browserPromise = null;
  if (pending) {
    try { await (await pending).close(); } catch { /* already gone */ }
  }
}

// Bounded wait for a render slot: past the deadline, give up rather than
// queue behind other crawls indefinitely.
function acquireSlot(deadline) {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i !== -1) waiters.splice(i, 1);
      reject(new Error('Timed out waiting for a free browser slot'));
    }, Math.max(0, deadline - Date.now()));
    waiters.push(waiter);
  });
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(); // hand the slot straight over; activeRenders unchanged
  } else {
    activeRenders -= 1;
    if (activeRenders === 0) scheduleIdleClose();
  }
}

// ---------------------------------------------------------------------
// Per-render egress proxy (layer 1 above).
// ---------------------------------------------------------------------

const HOP_BY_HOP = ['connection', 'proxy-connection', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

function splitHostPort(authority, defaultPort) {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(authority) || /^([^:]+)(?::(\d+))?$/.exec(authority);
  if (!m) return null;
  return { host: m[1], port: Number(m[2] || defaultPort) };
}

/**
 * @param {(hostname: string) => Promise<boolean>} hostAllowed
 * @returns {Promise<{ url: string, close: () => void }>}
 */
function startEgressProxy(hostAllowed) {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    let target;
    try {
      target = new URL(req.url); // proxies receive absolute-form URLs
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:' || !(await hostAllowed(target.hostname))) {
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    for (const h of HOP_BY_HOP) delete headers[h];
    const upstream = http.request(
      { host: target.hostname, port: target.port || 80, method: req.method, path: `${target.pathname}${target.search}`, headers },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      }
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // CONNECT carries HTTPS and WebSockets (ws:// included) through a proxy.
  server.on('connect', async (req, clientSocket, head) => {
    clientSocket.on('error', () => {});
    const target = splitHostPort(req.url, 443);
    if (!target || !(await hostAllowed(target.host))) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect(target.port, target.host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('close', () => upstream.destroy());
  });
  server.on('upgrade', (_req, socket) => socket.destroy()); // Chrome tunnels WS via CONNECT; refuse anything else
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          server.close();
          for (const s of sockets) s.destroy();
        }
      });
    });
  });
}

class BrowserRenderError extends Error {
  constructor(message, { httpStatus } = {}) {
    super(message);
    this.name = 'BrowserRenderError';
    this.httpStatus = httpStatus;
  }
}

function realisticUserAgent(browserUa) {
  // A real Chrome UA (sites serve their normal page to it, where
  // "HeadlessChrome" is often blocked outright), still honestly tagged with
  // our bot token so a site operator can identify and rate-limit us.
  return `${browserUa.replace(/HeadlessChrome/g, 'Chrome')} KGTAIHubBot/1.0`;
}

/**
 * Renders one URL in headless Chromium and returns the post-JavaScript HTML.
 * Same contract as crawler.js fetchSafe(): { html, finalUrl } for an HTML
 * page, null for non-HTML, throws on failure.
 * @param {string} urlString
 * @param {{ checkHost: (hostname: string) => Promise<void>, timeoutMs?: number }} opts
 *   checkHost must reject for any non-public host (crawler.js assertPublicHost).
 * @returns {Promise<{ html: string, finalUrl: URL } | null>}
 */
async function renderPage(urlString, { checkHost, timeoutMs = DEFAULT_RENDER_TIMEOUT_MS }) {
  if (typeof checkHost !== 'function') throw new Error('renderPage requires a checkHost guard');
  const deadline = Date.now() + timeoutMs;
  const target = new URL(urlString);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new BrowserRenderError('Only http/https URLs can be rendered');
  }
  await checkHost(target.hostname);

  // Per-render cache: one DNS check per host, not per request. Shared by
  // the egress proxy and request interception.
  const hostChecks = new Map();
  const hostAllowed = (hostname) => {
    if (!hostChecks.has(hostname)) {
      hostChecks.set(hostname, checkHost(hostname).then(() => true, () => false));
    }
    return hostChecks.get(hostname);
  };

  await acquireSlot(deadline);
  let context = null;
  let page = null;
  let proxy = null;
  try {
    const browser = await getBrowser();
    proxy = await startEgressProxy(hostAllowed);
    context = await browser.createBrowserContext({ proxyServer: proxy.url, proxyBypassList: ['<-loopback>'] });
    // Popups / window.open: close any extra tab the page spawns. (Our own
    // tab also fires targetcreated, before `page` is assigned — skipped.)
    context.on('targetcreated', async (t) => {
      if (t.type() !== 'page') return;
      const extra = await t.page().catch(() => null);
      if (extra && page && extra !== page) extra.close().catch(() => {});
    });
    page = await context.newPage();

    await page.setBypassServiceWorker(true);
    await page.setUserAgent(realisticUserAgent(await browser.userAgent()));
    await page.setViewport({ width: 1366, height: 900 });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (req.isInterceptResolutionHandled()) return;
      let allowed = false;
      try {
        const url = new URL(req.url());
        if (url.protocol === 'data:' || url.protocol === 'blob:') allowed = true;
        else if ((url.protocol === 'http:' || url.protocol === 'https:') && !BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
          allowed = await hostAllowed(url.hostname);
        }
      } catch {
        allowed = false;
      }
      if (req.isInterceptResolutionHandled()) return;
      (allowed ? req.continue() : req.abort('blockedbyclient')).catch(() => {});
    });

    let response;
    try {
      response = await page.goto(target.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1000, deadline - Date.now())
      });
    } catch (err) {
      throw new BrowserRenderError(`Could not render ${target.hostname}: ${err.message}`);
    }
    if (!response) throw new BrowserRenderError(`No response rendering ${target}`);
    const status = response.status();
    if (status >= 400) throw new BrowserRenderError(`${target} returned HTTP ${status} to the browser`, { httpStatus: status });
    const contentType = response.headers()['content-type'] || '';
    if (contentType && !contentType.includes('html')) return null;

    // "Settled" = network quiet AND enough visible text, whichever the page
    // manages before the deadline. Both waits are best-effort: a site that
    // polls forever never goes network-idle but may still be fully rendered,
    // so a timeout here means "read what's there", not "fail".
    const remaining = () => Math.max(0, deadline - Date.now() - 250);
    await page.waitForNetworkIdle({ idleTime: 500, timeout: remaining() }).catch(() => {});
    await page
      .waitForFunction(
        (min) => (document.body?.innerText || '').trim().split(/\s+/).filter(Boolean).length >= min,
        { timeout: Math.min(3000, remaining()), polling: 250 },
        CONTENT_WAIT_WORDS
      )
      .catch(() => {});

    const finalUrl = new URL(page.url());
    if (finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') {
      throw new BrowserRenderError('Rendered page ended on a non-http(s) URL');
    }
    let html = await page.evaluate(() => document.documentElement.outerHTML);
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);
    return { html, finalUrl };
  } finally {
    if (context) await context.close().catch(() => {});
    if (proxy) proxy.close();
    releaseSlot();
  }
}

module.exports = { renderPage, isBrowserAvailable, closeBrowser, BrowserRenderError, LAUNCH_ARGS };
