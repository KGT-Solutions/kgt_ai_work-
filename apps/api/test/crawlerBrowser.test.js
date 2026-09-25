const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const dns = require('dns').promises;

const { renderPage, isBrowserAvailable, closeBrowser } = require('../src/services/shared/crawlerBrowser');
const { crawlSite } = require('../src/services/shared/crawler');

// Real-Chromium tests. Skipped (not failed) where no Chromium binary exists
// — e.g. a dev box without one. The production image has one; run these
// there, or in `node:20-alpine` + `apk add chromium` (see DEPLOY notes).
const SKIP = isBrowserAvailable() ? false : 'no Chromium binary (set CRAWLER_BROWSER_PATH or install chromium)';

const LONG_P =
  'Our rendered storefront copy describes every product in enough detail to clear the thirty word ' +
  'minimum threshold the crawler uses when deciding whether a page is real content or an empty shell.';

// Two local servers stand in for "the public site" and "an internal service".
// The site is addressed as `localhost`, the internal one as `127.0.0.1` — and
// the injected guard allows only `localhost`, mirroring how assertPublicHost
// allows a public host and refuses a private one.
const guard = async (hostname) => {
  if (hostname !== 'localhost') throw new Error(`blocked ${hostname}`);
};

let site;
let internal;
let sitePort;
let internalPort;
const internalHits = [];

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('crawlerBrowser.renderPage — real headless Chromium', { skip: SKIP }, () => {
  before(async () => {
    internal = await listen((req, res) => {
      internalHits.push(req.url);
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      res.end('INTERNAL-SECRET-TOKEN');
    });
    internal.on('upgrade', (req, socket) => { internalHits.push(`ws:${req.url}`); socket.destroy(); });
    internalPort = internal.address().port;

    site = await listen((req, res) => {
      const internalBase = `127.0.0.1:${internalPort}`;
      if (req.url === '/spa') {
        res.writeHead(200, { 'content-type': 'text/html' });
        // An empty shell whose content only exists after JS runs — and whose
        // JS also tries every trick to reach the internal service.
        res.end(`<!doctype html><html><head><title>SPA Shop</title></head><body><div id="root"></div>
<script>
  setTimeout(() => {
    document.getElementById('root').innerHTML =
      '<main><h1>Rendered Catalog</h1><p>${LONG_P}</p><a href="/about">About</a></main>';
  }, 300);
  fetch('http://${internalBase}/fetch').then(r => r.text()).then(t => document.body.append(t)).catch(() => {});
  const x = new XMLHttpRequest(); x.open('GET', 'http://${internalBase}/xhr'); x.onload = () => document.body.append(x.responseText); x.send();
  try { new WebSocket('ws://${internalBase}/ws'); } catch (e) {}
  const f = document.createElement('iframe'); f.src = 'http://${internalBase}/iframe'; document.body.append(f);
  const s = document.createElement('script'); s.src = 'http://${internalBase}/script.js'; document.head.append(s);
  window.open('http://localhost:${sitePort}/popup');
</script></body></html>`);
      } else if (req.url === '/to-internal') {
        res.writeHead(302, { location: `http://${internalBase}/redirected` });
        res.end();
      } else if (req.url === '/file.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF-1.4');
      } else {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<p>nope</p>');
      }
    });
    sitePort = site.address().port;
  });

  after(async () => {
    await closeBrowser();
    site.close();
    internal.close();
  });

  test('executes client-side JS and returns the rendered DOM', async () => {
    const { html, finalUrl } = await renderPage(`http://localhost:${sitePort}/spa`, { checkHost: guard });
    assert.match(html, /Rendered Catalog/);
    assert.match(html, /clear the thirty word/);
    assert.equal(finalUrl.pathname, '/spa');
  });

  test('page JS cannot reach an internal host by fetch, XHR, WebSocket, iframe, or script', async () => {
    internalHits.length = 0;
    const { html } = await renderPage(`http://localhost:${sitePort}/spa`, { checkHost: guard });
    assert.doesNotMatch(html, /INTERNAL-SECRET-TOKEN/);
    assert.deepEqual(internalHits, [], `internal service was contacted: ${internalHits.join(', ')}`);
  });

  test('a redirect to an internal host is refused, not followed', async () => {
    internalHits.length = 0;
    await assert.rejects(() => renderPage(`http://localhost:${sitePort}/to-internal`, { checkHost: guard }));
    assert.deepEqual(internalHits, []);
  });

  test('the initial URL itself is checked before Chromium is involved', async () => {
    await assert.rejects(() => renderPage(`http://127.0.0.1:${internalPort}/`, { checkHost: guard }), /blocked/);
    assert.deepEqual(internalHits, []);
  });

  test('HTTP errors carry their status; non-HTML returns null', async () => {
    const err = await renderPage(`http://localhost:${sitePort}/missing`, { checkHost: guard }).catch((e) => e);
    assert.equal(err.httpStatus, 404);
    assert.equal(await renderPage(`http://localhost:${sitePort}/file.pdf`, { checkHost: guard }), null);
  });

  test('end to end: crawlSite falls back to the browser for the SPA shell and extracts clean markdown', async () => {
    // crawlSite's own SSRF check resolves `localhost` via dns.promises —
    // pretend it's public for this one test; the renderer keeps the strict guard.
    mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
    try {
      const result = await crawlSite(`http://localhost:${sitePort}/spa`, {
        browserFallback: true,
        renderer: (url, opts) => renderPage(url, { ...opts, checkHost: guard })
      });
      assert.equal(result.rendered, 1);
      assert.match(result.pages[0].markdown, /^## Rendered Catalog\n\n/);
      assert.doesNotMatch(result.pages[0].markdown, /INTERNAL-SECRET-TOKEN/);
    } finally {
      mock.restoreAll();
    }
  });
});
