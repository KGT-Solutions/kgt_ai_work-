const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;

const { crawlSite, CrawlerError } = require('../src/services/shared/crawler');

// Tier-2 orchestration tests: a fake renderer stands in for Chromium, so
// these run anywhere. Real-browser behaviour (interception, JS execution)
// is covered by crawlerBrowser.test.js, which needs a Chromium binary.

const LONG_P =
  'This is a sufficiently long paragraph of filler marketing copy that easily clears the thirty ' +
  'word minimum content threshold used by the crawler to decide whether a page counts as real ' +
  'substantive content worth saving as a training document.';

const SHELL = '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const rendered = (title, extra = '') =>
  `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${LONG_P}</p>${extra}</main></body></html>`;

function htmlResponse(body, { status = 200, contentType = 'text/html', location } = {}) {
  const headers = new Map([['content-type', contentType]]);
  if (location) headers.set('location', location);
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers.get(k.toLowerCase()) || null }, text: async () => body };
}

function makeRenderer(routes) {
  const calls = [];
  const renderer = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    const route = routes[u.pathname];
    if (!route) throw new Error('render failed');
    if (typeof route === 'function') return route(u, opts);
    return { html: route, finalUrl: u };
  };
  return { renderer, calls };
}

describe('crawlSite Tier 2: headless-browser fallback orchestration', () => {
  let staticCalls;
  let staticRoutes;

  beforeEach(() => {
    staticCalls = [];
    staticRoutes = {};
    mock.method(dns, 'lookup', async (hostname) =>
      hostname.startsWith('internal.') ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '8.8.8.8', family: 4 }]
    );
    mock.method(globalThis, 'fetch', async (url) => {
      const u = new URL(url);
      staticCalls.push(u.pathname);
      const route = staticRoutes[`${u.hostname}${u.pathname}`] ?? staticRoutes[u.pathname];
      if (route === undefined) return htmlResponse('not found', { status: 404 });
      return typeof route === 'function' ? route(u) : htmlResponse(route);
    });
  });
  afterEach(() => mock.restoreAll());

  test('an empty SPA shell is rendered, its rendered links are followed, and later pages render directly', async () => {
    staticRoutes = { '/': SHELL, '/about': SHELL, '/pricing': SHELL };
    const { renderer, calls } = makeRenderer({
      '/': rendered('Home', '<a href="/about">About</a><a href="/pricing">Pricing</a>'),
      '/about': rendered('About'),
      '/pricing': rendered('Pricing')
    });

    const result = await crawlSite('https://spa-test.example/', { browserFallback: true, renderer });
    assert.deepEqual(result.pages.map((p) => p.title).sort(), ['About', 'Home', 'Pricing']);
    assert.ok(result.pages.every((p) => p.rendered));
    assert.equal(result.rendered, 3);
    // Only the root was fetched statically; once it proved to be an SPA,
    // /about and /pricing went straight to the renderer.
    assert.deepEqual(staticCalls, ['/']);
    assert.equal(calls.length, 3);
  });

  test('without browserFallback (the public /analyze route) the renderer is never called', async () => {
    staticRoutes = { '/': SHELL };
    const { renderer, calls } = makeRenderer({ '/': rendered('Home') });
    await assert.rejects(
      () => crawlSite('https://spa-test.example/', { renderer }),
      (err) => err instanceof CrawlerError && err.statusCode === 422
    );
    assert.equal(calls.length, 0);
  });

  test('a 403 from the static fetch is retried in the browser; a 404 is not', async () => {
    staticRoutes = {
      '/': () => htmlResponse('blocked', { status: 403 }),
      '/gone': () => htmlResponse('nope', { status: 404 })
    };
    const { renderer, calls } = makeRenderer({ '/': rendered('Home', '<a href="/gone">Gone</a>') });

    const result = await crawlSite('https://waf-test.example/', { browserFallback: true, renderer });
    assert.equal(result.pages[0].title, 'Home');
    // /gone: preferBrowser is on after the root render, so it IS rendered
    // first — the fake renderer has no route for it, so it then falls back
    // to static, gets a 404, and is skipped (not retried again).
    assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/', '/gone']);
    assert.equal(result.skipped, 1);
  });

  test('a 404 on a static-first site never reaches the browser', async () => {
    staticRoutes = { '/': rendered('Home', '<a href="/gone">Gone</a>') };
    const { renderer, calls } = makeRenderer({});
    const result = await crawlSite('https://static-test.example/', { browserFallback: true, renderer });
    assert.equal(result.pages.length, 1);
    assert.equal(calls.length, 0);
  });

  test('a page whose redirect is refused by the SSRF guard is never handed to the browser', async () => {
    staticRoutes = {
      '/': rendered('Home', '<a href="/trap">Trap</a>'),
      '/trap': () => htmlResponse('', { status: 302, location: 'http://internal.spa-test.example/' })
    };
    const { renderer, calls } = makeRenderer({});
    await crawlSite('https://spa-test.example/', { browserFallback: true, renderer });
    assert.equal(calls.length, 0);
  });

  test('the renderer is given the real SSRF guard as checkHost', async () => {
    staticRoutes = { '/': SHELL };
    let guard;
    const renderer = async (url, { checkHost }) => {
      guard = checkHost;
      return { html: rendered('Home'), finalUrl: new URL(url) };
    };
    await crawlSite('https://spa-test.example/', { browserFallback: true, renderer });
    await assert.rejects(() => guard('internal.spa-test.example'), CrawlerError);
    await guard('public.spa-test.example'); // resolves
  });

  test('a render that fails leaves the thin static page skipped, and the crawl reports 422 if nothing else exists', async () => {
    staticRoutes = { '/': SHELL };
    const { renderer } = makeRenderer({}); // every render throws
    await assert.rejects(
      () => crawlSite('https://spa-test.example/', { browserFallback: true, renderer }),
      (err) => err.statusCode === 422
    );
  });

  test('a render that navigates off-site client-side is discarded, not saved', async () => {
    staticRoutes = { '/': SHELL };
    const { renderer } = makeRenderer({
      '/': (u) => ({ html: rendered('Elsewhere'), finalUrl: new URL('https://other-site.example/landing') })
    });
    await assert.rejects(
      () => crawlSite('https://spa-test.example/', { browserFallback: true, renderer }),
      (err) => err.statusCode === 422
    );
  });

  test('renders are capped per crawl', async () => {
    const links = Array.from({ length: 11 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('');
    staticRoutes = { '/': SHELL };
    const routes = { '/': rendered('Home', links) };
    for (let i = 0; i < 11; i++) {
      staticRoutes[`/p${i}`] = SHELL;
      routes[`/p${i}`] = rendered(`Page ${i}`);
    }
    const { renderer, calls } = makeRenderer(routes);
    const result = await crawlSite('https://spa-test.example/', { browserFallback: true, renderer });
    assert.equal(calls.length, 8);
    assert.equal(result.rendered, 8);
  });

  test('when an SPA render later fails, that page still falls back to its static HTML', async () => {
    staticRoutes = { '/': SHELL, '/about': rendered('About (static)') };
    const { renderer } = makeRenderer({ '/': rendered('Home', '<a href="/about">About</a>') }); // /about render throws
    const result = await crawlSite('https://spa-test.example/', { browserFallback: true, renderer });
    const about = result.pages.find((p) => p.title === 'About (static)');
    assert.ok(about);
    assert.equal(about.rendered, false);
  });
});

describe('crawlSite: same-site rules (both tiers)', () => {
  beforeEach(() => mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]));
  afterEach(() => mock.restoreAll());

  test('an apex -> www redirect no longer strands the crawl on the homepage', async () => {
    mock.method(globalThis, 'fetch', async (url) => {
      const u = new URL(url);
      if (u.hostname === 'acme-test.example') return htmlResponse('', { status: 301, location: `https://www.acme-test.example${u.pathname}` });
      if (u.pathname === '/') return htmlResponse(rendered('Home', '<a href="https://www.acme-test.example/about">About</a>'));
      if (u.pathname === '/about') return htmlResponse(rendered('About'));
      return htmlResponse('nf', { status: 404 });
    });
    const result = await crawlSite('https://acme-test.example/');
    assert.deepEqual(result.pages.map((p) => p.title).sort(), ['About', 'Home']);
  });

  test('a same-site link that redirects to another domain is not saved', async () => {
    mock.method(globalThis, 'fetch', async (url) => {
      const u = new URL(url);
      if (u.hostname === 'acme-test.example' && u.pathname === '/') return htmlResponse(rendered('Home', '<a href="/shop">Shop</a>'));
      if (u.pathname === '/shop') return htmlResponse('', { status: 302, location: 'https://other-store.example/' });
      if (u.hostname === 'other-store.example') return htmlResponse(rendered('Someone Else'));
      return htmlResponse('nf', { status: 404 });
    });
    const result = await crawlSite('https://acme-test.example/');
    assert.deepEqual(result.pages.map((p) => p.title), ['Home']);
  });
});
