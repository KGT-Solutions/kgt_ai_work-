const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;

const { crawlSite, CrawlerError, describeStartFailure } = require('../src/services/shared/crawler');

// When a crawl finds nothing, the error says why the start page failed and
// what to do instead — not one generic "no readable content" for everything.

const LONG_P =
  'This is a sufficiently long paragraph of filler marketing copy that easily clears the thirty ' +
  'word minimum content threshold used by the crawler to decide whether a page counts as real ' +
  'substantive content worth saving as a training document.';
const PAGE = `<html><head><title>Home</title></head><body><main><h1>Home</h1><p>${LONG_P}</p></main></body></html>`;
const SHELL = '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';

function htmlResponse(body, { status = 200, location } = {}) {
  const headers = new Map([['content-type', 'text/html']]);
  if (location) headers.set('location', location);
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers.get(k.toLowerCase()) || null }, text: async () => body };
}

describe('crawlSite — a crawl that finds nothing says why', () => {
  let respond;
  let calls;
  beforeEach(() => {
    calls = [];
    mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
    mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return respond(new URL(url), calls.length);
    });
  });
  afterEach(() => mock.restoreAll());

  const failsWith = async (pattern) => {
    await assert.rejects(crawlSite('https://shop.example.com/'), (err) => {
      assert.ok(err instanceof CrawlerError);
      assert.equal(err.statusCode, 422);
      assert.match(err.message, pattern);
      return true;
    });
  };

  test('requests name the bot in the conventional Mozilla/5.0 (compatible; ...) form and ask for HTML', async () => {
    respond = () => htmlResponse(PAGE);
    await crawlSite('https://shop.example.com/');
    const h = calls[0].headers;
    assert.equal(h['user-agent'], 'Mozilla/5.0 (compatible; KGTAIHubBot/1.0)');
    assert.match(h.accept, /text\/html/);
    assert.ok(h['accept-language']);
  });

  test('a site that blocks bots (403) is reported as blocked, with the PDF alternative', async () => {
    respond = () => htmlResponse('Access denied', { status: 403 });
    await failsWith(/shop\.example\.com blocks automated readers \(HTTP 403\).*Upload a PDF/);
  });

  test('a missing start page (404) asks to check the address', async () => {
    respond = () => htmlResponse('nope', { status: 404 });
    await failsWith(/wasn't found on shop\.example\.com \(HTTP 404\)\. Check the address/);
  });

  test('a JavaScript-only shell, with no browser tier, is explained as such', async () => {
    respond = () => htmlResponse(SHELL);
    await failsWith(/builds its pages with JavaScript/);
  });

  test('a start page that redirects to another site says so', async () => {
    respond = (u) => (u.hostname === 'shop.example.com' ? htmlResponse('', { status: 301, location: 'https://other-site.example.org/' }) : htmlResponse(PAGE));
    await failsWith(/redirects to a different website/);
  });

  test('a dropped connection on the start page is retried once, then reported if it persists', async () => {
    respond = (_u, n) => { if (n === 1) throw new TypeError('fetch failed'); return htmlResponse(PAGE); };
    const ok = await crawlSite('https://shop.example.com/');
    assert.equal(ok.pages.length, 1, 'the retry should have recovered');

    calls.length = 0;
    respond = () => { throw new TypeError('fetch failed'); };
    await failsWith(/Couldn't connect to shop\.example\.com/);
    assert.equal(calls.length, 2, 'exactly one retry');
  });

  test('a gateway error (502) on the start page is retried once too', async () => {
    respond = (_u, n) => (n === 1 ? htmlResponse('bad gateway', { status: 502 }) : htmlResponse(PAGE));
    const ok = await crawlSite('https://shop.example.com/');
    assert.equal(ok.pages.length, 1);
  });
});

describe('describeStartFailure', () => {
  test('timeouts, rate limits and server errors each get their own advice', () => {
    assert.match(describeStartFailure('a.com', { failure: { kind: 'timeout' } }), /a\.com took too long to respond/);
    assert.match(describeStartFailure('a.com', { failure: { httpStatus: 429 } }), /limiting automated requests.*few minutes/);
    assert.match(describeStartFailure('a.com', { failure: { httpStatus: 500 } }), /server error \(HTTP 500\)/);
  });

  test('a thin page the browser tier also failed on gets the general message, not the JavaScript one', () => {
    const msg = describeStartFailure('a.com', { outcome: 'thin', usedBrowser: true });
    assert.match(msg, /No readable content could be extracted from a\.com/);
    assert.doesNotMatch(msg, /JavaScript/);
  });
});
