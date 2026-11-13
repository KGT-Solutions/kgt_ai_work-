const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;
const { crawlSite, scanBrand, CrawlerError } = require('../../src/services/shared/crawler');

// The crawler's brand pass (Theme Studio), end to end through fetchSafe with
// DNS and fetch mocked: the start page's logo and theme colour, a linked
// stylesheet fetched under the same SSRF guards, and failures that never
// break the crawl.

const PUBLIC_IP = { address: '93.184.216.34', family: 4 };
const BODY = '<p>' + 'Acme Foods makes fresh organic snacks delivered across India every single week. '.repeat(4) + '</p>';

const HOME = `<html><head><title>Acme Foods</title>
  <meta name="theme-color" content="#E4572E">
  <link rel="stylesheet" href="/css/site.css">
  <link rel="icon" href="/favicon.png" sizes="32x32">
  </head><body>
  <header><a class="logo" href="/"><img src="/img/logo.svg" alt="Acme Foods"></a><nav><a href="/about">About</a></nav></header>
  <main><h1>Fresh snacks</h1>${BODY}</main></body></html>`;

const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const css = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/css' } });

afterEach(() => mock.restoreAll());

describe('crawlSite: brand kit from the start page', () => {
  test('returns the logo, the theme colour and colours from the linked stylesheet', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    const fetched = [];
    mock.method(globalThis, 'fetch', async (url) => {
      fetched.push(String(url));
      if (String(url).endsWith('/css/site.css')) return css('.btn{background:#2563eb} .tag{background:#16a34a}');
      return html(String(url).endsWith('/about') ? `<main><h1>About</h1>${BODY}</main>` : HOME);
    });
    const result = await crawlSite('https://acme.test/', { maxPages: 2 });
    assert.ok(result.pages.length >= 1);
    assert.equal(result.brand.logoUrl, 'https://acme.test/img/logo.svg');
    assert.equal(result.brand.faviconUrl, 'https://acme.test/favicon.png');
    assert.equal(result.brand.primaryColor, '#e4572e');
    assert.ok(result.brand.colors.includes('#2563eb'), 'stylesheet colours are read');
    assert.ok(fetched.includes('https://acme.test/css/site.css'));
    // The header was still stripped from the saved page text.
    assert.ok(!result.pages[0].markdown.includes('About'), 'nav links stay out of the trained content');
  });

  test('a stylesheet that fails is skipped; the crawl and the rest of the brand still succeed', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async (url) =>
      (String(url).endsWith('.css') ? new Response('nope', { status: 500 }) : html(HOME)));
    const result = await crawlSite('https://acme.test/', { maxPages: 1 });
    assert.equal(result.pages.length, 1);
    assert.equal(result.brand.primaryColor, '#e4572e');
    assert.equal(result.brand.logoUrl, 'https://acme.test/img/logo.svg');
  });

  test('a stylesheet on a private address is refused by the SSRF guard, not fetched', async () => {
    mock.method(dns, 'lookup', async (host) => (host === 'internal.acme.test' ? [{ address: '10.0.0.5', family: 4 }] : [PUBLIC_IP]));
    const fetched = [];
    mock.method(globalThis, 'fetch', async (url) => {
      fetched.push(String(url));
      return html(HOME.replace('/css/site.css', 'https://internal.acme.test/secret.css'));
    });
    const result = await crawlSite('https://acme.test/', { maxPages: 1 });
    assert.ok(!fetched.some((u) => u.includes('internal.acme.test')));
    assert.equal(result.brand.primaryColor, '#e4572e');
  });
});

describe('scanBrand (dashboard "Rescan website")', () => {
  test('reads one homepage without crawling the rest of the site', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    const fetched = [];
    mock.method(globalThis, 'fetch', async (url) => {
      fetched.push(String(url));
      return String(url).endsWith('.css') ? css('.x{background:#2563eb}') : html(HOME);
    });
    const brand = await scanBrand('https://acme.test/');
    assert.equal(brand.logoUrl, 'https://acme.test/img/logo.svg');
    assert.equal(brand.primaryColor, '#e4572e');
    assert.ok(!fetched.some((u) => u.endsWith('/about')), 'no other pages are fetched');
  });

  test('refuses private addresses and non-web URLs, and a non-HTML page is a 422', async () => {
    mock.method(dns, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
    await assert.rejects(() => scanBrand('http://localhost:4000/'), CrawlerError);
    mock.restoreAll();
    await assert.rejects(() => scanBrand('file:///etc/passwd'), CrawlerError);
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }));
    await assert.rejects(() => scanBrand('https://acme.test/brochure.pdf'), (e) => e instanceof CrawlerError && e.statusCode === 422);
  });
});

describe('brand scan: logo analysis', () => {
  test('the logo image is downloaded through fetchSafe and analysed', async () => {
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 120, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 90, height: 20, channels: 4, background: { r: 17, g: 24, b: 39, alpha: 1 } } }).png().toBuffer(), top: 10, left: 15 }])
      .png().toBuffer();
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async (url) => {
      if (String(url).endsWith('/img/logo.svg')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      if (String(url).endsWith('.css')) return css('.x{background:#2563eb}');
      return html(HOME);
    });
    const brand = await scanBrand('https://acme.test/');
    assert.deepEqual(brand.logoAppearance, { background: 'transparent', backgroundColor: null, tone: 'dark', monochrome: true });
  });

  test('a logo that is not an image, or cannot be read, leaves the analysis null', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async (url) => (String(url).endsWith('/img/logo.svg')
      ? new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      : html(HOME)));
    const brand = await scanBrand('https://acme.test/');
    assert.equal(brand.logoUrl, 'https://acme.test/img/logo.svg');
    assert.equal(brand.logoAppearance, null);
  });
});
