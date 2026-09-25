const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;

// Neither `dns.lookup` nor the global `fetch` is destructured by crawler.js
// — both are accessed as live property/global lookups at call time — so,
// unlike some other mocks in this suite, these can be (re)installed in any
// order relative to requiring crawler.js.
const {
  crawlSite, extractPage, isPrivateIPv4, isPrivateIPv6, isBoilerplateLine, CrawlerError
} = require('../src/services/shared/crawler');

const PUBLIC_IP = { address: '8.8.8.8', family: 4 };

// crawlSite drops any page under 30 words as a stub/redirect page — every
// fixture paragraph below is built on this (39-word) filler so real
// fixture content reliably survives that filter. Getting this wrong is an
// easy, silent way to make a fixture page vanish from result.pages instead
// of failing loudly, so it's centralized here rather than eyeballed per test.
const LONG_P =
  'This is a sufficiently long paragraph of filler marketing copy that easily clears the thirty ' +
  'word minimum content threshold used by the crawler to decide whether a page counts as real ' +
  'substantive content worth saving as a training document.';

function html(strings) {
  return strings.join('\n');
}

function htmlResponse(body, { status = 200, contentType = 'text/html', location } = {}) {
  const headers = new Map([['content-type', contentType]]);
  if (location) headers.set('location', location);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers.get(k.toLowerCase()) || null },
    text: async () => body
  };
}

describe('crawler: SSRF guards', () => {
  test('isPrivateIPv4 flags loopback, RFC1918 ranges, and the cloud-metadata address', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.169.254', '0.0.0.0']) {
      assert.equal(isPrivateIPv4(ip), true, `expected ${ip} to be flagged private`);
    }
    assert.equal(isPrivateIPv4('8.8.8.8'), false);
    assert.equal(isPrivateIPv4('93.184.216.34'), false);
  });

  test('isPrivateIPv6 flags loopback, link-local, unique-local, and IPv4-mapped private addresses', () => {
    assert.equal(isPrivateIPv6('::1'), true);
    assert.equal(isPrivateIPv6('fe80::1'), true);
    assert.equal(isPrivateIPv6('fd00::1'), true);
    assert.equal(isPrivateIPv6('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIPv6('2607:f8b0::1'), false); // a real public range (Google)
  });

  test('crawlSite rejects a hostname that resolves to a private address', async () => {
    mock.method(dns, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
    await assert.rejects(() => crawlSite('http://internal.acme-test.example'), CrawlerError);
    mock.restoreAll();
  });

  test('crawlSite rejects a URL with a non-http(s) protocol before ever resolving DNS', async () => {
    const lookupSpy = mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    await assert.rejects(() => crawlSite('ftp://acme-test.example'), CrawlerError);
    assert.equal(lookupSpy.mock.callCount(), 0);
    mock.restoreAll();
  });

  test('crawlSite rejects an unresolvable hostname', async () => {
    mock.method(dns, 'lookup', async () => { throw new Error('ENOTFOUND'); });
    await assert.rejects(() => crawlSite('http://does-not-exist.acme-test.example'), CrawlerError);
    mock.restoreAll();
  });
});

describe('crawler: extractPage — chrome stripping and heading-to-markdown conversion', () => {
  test('drops nav/header/footer/script content, keeps h1-h3/p/li as ## sections', () => {
    const page = extractPage(
      html([
        '<html><head><title>Acme Inc</title></head><body>',
        '<nav>Home About Pricing</nav>',
        '<header>Acme logo</header>',
        '<h1>Welcome to Acme</h1>',
        '<p>Acme builds widgets for the modern age and serves customers worldwide with great support daily.</p>',
        '<h2>FAQ</h2>',
        '<p>Do you offer refunds? Yes, within 30 days of purchase, no questions asked at all times.</p>',
        '<ul><li>Fast shipping</li><li>24/7 support</li></ul>',
        '<footer>copyright 2026 Acme</footer>',
        "<script>trackVisitor()</script>",
        '</body></html>'
      ]),
      new URL('https://acme-test.example/about')
    );

    assert.equal(page.title, 'Acme Inc');
    assert.doesNotMatch(page.markdown, /Home About Pricing/);
    assert.doesNotMatch(page.markdown, /copyright 2026/);
    assert.doesNotMatch(page.markdown, /trackVisitor/);
    assert.match(page.markdown, /## Welcome to Acme/);
    assert.match(page.markdown, /## FAQ/);
    assert.match(page.markdown, /Fast shipping/);
  });

  test('a page with no heading structure falls back to a single "## Overview" section', () => {
    const page = extractPage(
      '<html><body><p>Just some plain marketing copy with no headings anywhere on this page at all.</p></body></html>',
      new URL('https://acme-test.example/blurb')
    );
    assert.match(page.markdown, /^## Overview/);
  });

  test('strips e-commerce chrome (cart drawer, modal, newsletter, breadcrumb, OneTrust banner)', () => {
    const page = extractPage(
      html([
        '<body>',
        '<div class="cart"><p>Your cart is empty</p></div>',
        '<div class="modal"><p>Get 10% off your first order when you sign up today</p></div>',
        '<div class="newsletter"><p>Join our list for weekly deals</p></div>',
        '<ol class="breadcrumb"><li>Home</li><li>Protein</li></ol>',
        '<div id="onetrust-banner-sdk"><p>This site uses tracking technologies to personalize content</p></div>',
        `<main><h1>Whey Protein</h1><p>${LONG_P}</p></main>`,
        '</body>'
      ]),
      new URL('https://gnc-test.example/whey')
    );
    assert.doesNotMatch(page.markdown, /cart is empty|10% off|weekly deals|tracking technologies|Home/);
    assert.match(page.markdown, /## Whey Protein/);
  });

  test('prefers a specific content wrapper over a generic promo <section> when there is no <main>', () => {
    const page = extractPage(
      html([
        '<body>',
        '<section class="promo"><h2>Summer Sale</h2><p>Save 20% sitewide this weekend only.</p></section>',
        `<div class="product-description"><h1>Whey Protein</h1><p>${LONG_P}</p></div>`,
        '</body>'
      ]),
      new URL('https://gnc-test.example/whey')
    );
    assert.match(page.markdown, /## Whey Protein/);
    assert.doesNotMatch(page.markdown, /Summer Sale/);
  });

  test('falls through a near-empty <main> shell to content elsewhere instead of returning nothing', () => {
    const page = extractPage(
      `<body><main><div id="app"></div></main><div class="content-body"><h1>Directions</h1><p>${LONG_P}</p></div></body>`,
      new URL('https://gnc-test.example/directions')
    );
    assert.match(page.markdown, /## Directions/);
    assert.ok(page.wordCount >= 30);
  });

  test('an FAQ accordion <li><h3>Q</h3><p>A</p></li> is emitted once, as its own section', () => {
    const page = extractPage(
      '<main><ul><li><h3>Is it vegan?</h3><p>No, it contains milk.</p></li></ul></main>',
      new URL('https://gnc-test.example/faq')
    );
    assert.equal(page.markdown, '## Is it vegan?\n\nNo, it contains milk.');
  });

  test('list items become "- " bullets and <br> does not glue words together', () => {
    const page = extractPage(
      '<main><h2>Ingredients</h2><ul><li>Whey isolate</li><li>Cocoa</li></ul><p>Take one scoop<br>with water.</p></main>',
      new URL('https://gnc-test.example/whey')
    );
    assert.match(page.markdown, /^- Whey isolate$/m);
    assert.match(page.markdown, /Take one scoop with water\./);
  });

  test('falls back to the h1, then the URL path, when there is no <title>', () => {
    const withH1 = extractPage('<body><h1>Fallback Title</h1><p>text</p></body>', new URL('https://x.example/p'));
    assert.equal(withH1.title, 'Fallback Title');
    const withNeither = extractPage('<body><p>text</p></body>', new URL('https://x.example/some-page'));
    assert.equal(withNeither.title, '/some-page');
  });
});

describe('crawler: isBoilerplateLine', () => {
  test('drops bare UI labels and short boilerplate snippets', () => {
    for (const line of ['Menu', '  Search ', 'Sign In', 'Your cart is empty', '© 2026 GNC. All rights reserved.', 'Cookie Policy']) {
      assert.equal(isBoilerplateLine(line), true, `expected "${line}" to be boilerplate`);
    }
  });

  test('keeps real sentences that merely contain a UI word or blacklisted phrase', () => {
    for (const line of [
      'See our full menu of services for athletes and busy parents alike.',
      'How do I order? Click Add to Cart on any product page, then check out with a card or PayPal in seconds.',
      'Returns are covered under our terms of service, which allow refunds within 30 days of purchase for any reason.'
    ]) {
      assert.equal(isBoilerplateLine(line), false, `expected "${line}" to be kept`);
    }
  });
});

describe('crawler: crawlSite orchestration (mocked DNS + fetch, real BFS/priority/extraction)', () => {
  const PAGES = {
    '/': html([
      '<html><head><title>Acme Home</title></head><body>',
      '<nav><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/blog/post-1">Blog</a>',
      '<a href="https://other-domain.example/">External</a></nav>',
      `<h1>Acme</h1><p>${LONG_P}</p>`,
      '</body></html>'
    ]),
    '/about': html([
      '<html><head><title>About Acme</title></head><body>',
      `<h1>About Us</h1><p>${LONG_P}</p>`,
      '</body></html>'
    ]),
    '/pricing': html([
      '<html><head><title>Acme Pricing</title></head><body>',
      `<h1>Pricing</h1><p>${LONG_P}</p>`,
      '</body></html>'
    ]),
    '/blog/post-1': html([
      '<html><head><title>Blog Post</title></head><body>',
      `<h1>Our Journey</h1><p>${LONG_P}</p>`,
      '</body></html>'
    ])
  };

  beforeEach(() => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async (url) => {
      const path = new URL(url).pathname;
      if (path in PAGES) return htmlResponse(PAGES[path]);
      return htmlResponse('not found', { status: 404 });
    });
  });
  afterEach(() => mock.restoreAll());

  test('crawls the base page plus same-domain links, and reports the base host', async () => {
    const result = await crawlSite('https://acme-test.example/', { maxPages: 10 });
    assert.equal(result.baseHost, 'acme-test.example');
    const titles = result.pages.map((p) => p.title);
    assert.ok(titles.includes('Acme Home'));
    assert.ok(titles.includes('About Acme'));
    assert.ok(titles.includes('Acme Pricing'));
  });

  test('never crawls the external link — same-domain restriction is enforced', async () => {
    const result = await crawlSite('https://acme-test.example/', { maxPages: 10 });
    assert.ok(!result.pages.some((p) => p.url.includes('other-domain.example')));
  });

  test('priority pages (About/Pricing) are crawled before a non-priority link when the page budget is tight', async () => {
    // Budget: home + exactly 2 more. About/Pricing carry priority keywords in
    // their href/anchor text; the blog post does not — it should be the one
    // left out, not one of the priority pages.
    const result = await crawlSite('https://acme-test.example/', { maxPages: 3 });
    const titles = result.pages.map((p) => p.title);
    assert.ok(titles.includes('About Acme'));
    assert.ok(titles.includes('Acme Pricing'));
    assert.ok(!titles.includes('Blog Post'));
  });

  test('respects maxPages as a hard cap', async () => {
    const result = await crawlSite('https://acme-test.example/', { maxPages: 1 });
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].title, 'Acme Home');
  });

  test('each returned page carries "## " sections that parseIntoChunks can chunk', async () => {
    const { parseIntoChunks } = require('../src/engine/knowledgeLoader');
    const result = await crawlSite('https://acme-test.example/', { maxPages: 2 });
    const chunks = parseIntoChunks(result.pages[0].title, result.pages[0].markdown);
    assert.ok(chunks.length > 0);
    assert.notEqual(chunks[0].title, 'Overview'); // real heading text, not the no-heading fallback
  });

  test('a non-HTML linked page is skipped, not treated as a crawl failure', async () => {
    mock.method(globalThis, 'fetch', async (url) => {
      const path = new URL(url).pathname;
      if (path === '/') {
        return htmlResponse(`<html><body><h1>Acme</h1><p>${LONG_P}</p><a href="/brochure.pdf">Brochure</a></body></html>`);
      }
      if (path === '/brochure.pdf') return htmlResponse('%PDF-1.4 binary', { contentType: 'application/pdf' });
      return htmlResponse('not found', { status: 404 });
    });
    const result = await crawlSite('https://acme-test.example/', { maxPages: 5 });
    assert.equal(result.skipped, 1);
    assert.ok(!result.pages.some((p) => p.url.endsWith('.pdf')));
  });

  test('follows a redirect to its final same-domain destination', async () => {
    mock.method(globalThis, 'fetch', async (url) => {
      const path = new URL(url).pathname;
      if (path === '/') {
        return htmlResponse(`<html><body><h1>Acme</h1><p>${LONG_P}</p><a href="/old-about">About</a></body></html>`);
      }
      if (path === '/old-about') return htmlResponse('', { status: 301, location: '/about' });
      if (path === '/about') return htmlResponse(PAGES['/about']);
      return htmlResponse('not found', { status: 404 });
    });
    const result = await crawlSite('https://acme-test.example/', { maxPages: 5 });
    const about = result.pages.find((p) => p.title === 'About Acme');
    assert.ok(about, 'the redirected page should still be captured under its final URL');
    assert.match(about.url, /\/about$/);
  });

  test('a same-domain page whose redirect target resolves to a private address is skipped, not silently followed', async () => {
    // The base page has real content of its own (so the overall crawl still
    // succeeds) plus one link that 302s to a private-address host — that
    // linked page must never show up in result.pages, and must count
    // against `skipped` instead of crashing the whole crawl.
    mock.method(dns, 'lookup', async (hostname) => {
      if (hostname === 'internal.acme-test.example') return [{ address: '10.0.0.5', family: 4 }];
      return [PUBLIC_IP];
    });
    mock.method(globalThis, 'fetch', async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'acme-test.example' && parsed.pathname === '/') {
        return htmlResponse(`<html><body><h1>Acme</h1><p>${LONG_P}</p><a href="/redirect-trap">Trap</a></body></html>`);
      }
      if (parsed.hostname === 'acme-test.example' && parsed.pathname === '/redirect-trap') {
        return htmlResponse('', { status: 302, location: 'http://internal.acme-test.example/' });
      }
      return htmlResponse('should never be fetched');
    });

    const result = await crawlSite('https://acme-test.example/', { maxPages: 5 });
    assert.ok(result.pages.some((p) => p.title === 'Acme')); // the safe page still made it through
    assert.ok(!result.pages.some((p) => p.url.includes('internal.acme-test.example')));
    assert.ok(result.skipped >= 1);
  });
});
