const { test, describe, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const dns = require('dns').promises;
const {
  fetchSafe, readBody, analyzeLogoUrl, MAX_HTML_BYTES, CrawlerError
} = require('../../src/services/shared/crawler');

// fetchSafe's body handling (adversarial review): the timeout must cover the
// body, the byte cap must stop reading rather than truncate afterwards, and a
// body that won't be read must be released.

const PUBLIC_IP = { address: '93.184.216.34', family: 4 };
const MB = 1024 * 1024;
afterEach(() => mock.restoreAll());

// A body produced on demand in 1 MB chunks; `state` records how much was
// actually pulled from it and whether the reader cancelled it.
function countingStream(totalBytes) {
  const state = { pulled: 0, cancelled: false };
  const block = new Uint8Array(MB).fill(97); // "a"
  const stream = new ReadableStream({
    pull(controller) {
      if (state.pulled >= totalBytes) return controller.close();
      state.pulled += MB;
      controller.enqueue(block);
    },
    cancel() { state.cancelled = true; }
  });
  return { stream, state };
}

describe('fetchSafe: the timeout covers the body, not just the headers', () => {
  let server;
  let base;
  let prevAllow;
  before(async () => {
    prevAllow = process.env.CRAWLER_ALLOW_PRIVATE_HOSTS;
    process.env.CRAWLER_ALLOW_PRIVATE_HOSTS = 'true'; // the test server is on loopback
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('<html><head>'); // …and the body never finishes
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.closeAllConnections?.();
    server.close();
    if (prevAllow === undefined) delete process.env.CRAWLER_ALLOW_PRIVATE_HOSTS;
    else process.env.CRAWLER_ALLOW_PRIVATE_HOSTS = prevAllow;
  });

  test('a real server that sends headers then stalls is cut off at the timeout', async () => {
    const started = Date.now();
    await assert.rejects(() => fetchSafe(`${base}/`, { timeoutMs: 400 }),
      (e) => e instanceof CrawlerError && e.kind === 'timeout');
    assert.ok(Date.now() - started < 3000, 'gave up at the timeout instead of hanging');
  });

  test('a stalled body whose stream ignores the abort is still cut off (no reliance on fetch internals)', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('<html><head>')); } // never closes, never errors
    }), { status: 200, headers: { 'content-type': 'text/html' } }));
    const started = Date.now();
    await assert.rejects(() => fetchSafe('https://stall.acme.test/', { timeoutMs: 300 }),
      (e) => e instanceof CrawlerError && e.kind === 'timeout');
    assert.ok(Date.now() - started < 2000);
  });
});

describe('fetchSafe: the byte cap stops reading', () => {
  test('a page is truncated at the cap and the rest of the stream is never pulled', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    const { stream, state } = countingStream(40 * MB);
    mock.method(globalThis, 'fetch', async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }));
    const out = await fetchSafe('https://acme.test/');
    assert.equal(out.html.length, MAX_HTML_BYTES);
    assert.ok(state.pulled <= MAX_HTML_BYTES + 2 * MB, `pulled ${state.pulled / MB} MB of 40`);
    assert.equal(state.cancelled, true);
  });

  test('an image over its cap is refused, not buffered (no Content-Length to warn us)', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    const { stream, state } = countingStream(40 * MB);
    mock.method(globalThis, 'fetch', async () => new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } }));
    assert.equal(await analyzeLogoUrl('https://acme.test/logo.png'), null);
    assert.ok(state.pulled <= 4 * MB, `pulled ${state.pulled / MB} MB of 40`);
    assert.equal(state.cancelled, true);
  });

  test('an image that declares an oversize Content-Length is refused before its body is read', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    const { stream, state } = countingStream(40 * MB);
    mock.method(globalThis, 'fetch', async () => new Response(stream, {
      status: 200, headers: { 'content-type': 'image/png', 'content-length': String(40 * MB) }
    }));
    const out = await fetchSafe('https://acme.test/logo.png', { accept: (ct) => ct.startsWith('image/'), responseType: 'buffer', maxBytes: MB });
    assert.equal(out, null);
    assert.ok(state.pulled <= MB, 'at most the chunk the stream pre-buffers on its own');
    assert.equal(state.cancelled, true);
  });

  test('a body under the cap is returned whole', async () => {
    mock.method(dns, 'lookup', async () => [PUBLIC_IP]);
    mock.method(globalThis, 'fetch', async () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    assert.equal((await fetchSafe('https://acme.test/')).html, '<html>ok</html>');
  });
});

describe('fetchSafe: bodies it will not read are released', () => {
  const lookup = () => mock.method(dns, 'lookup', async () => [PUBLIC_IP]);

  test('a content type the caller does not read', async () => {
    lookup();
    const { stream, state } = countingStream(5 * MB);
    mock.method(globalThis, 'fetch', async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/pdf' } }));
    assert.equal(await fetchSafe('https://acme.test/brochure.pdf'), null);
    assert.equal(state.cancelled, true);
  });

  test('an error status', async () => {
    lookup();
    const { stream, state } = countingStream(5 * MB);
    mock.method(globalThis, 'fetch', async () => new Response(stream, { status: 404, headers: { 'content-type': 'text/html' } }));
    await assert.rejects(() => fetchSafe('https://acme.test/missing'), (e) => e instanceof CrawlerError && e.httpStatus === 404);
    assert.equal(state.cancelled, true);
  });

  test('each redirect hop', async () => {
    lookup();
    const { stream, state } = countingStream(5 * MB);
    let call = 0;
    mock.method(globalThis, 'fetch', async () => (call++ === 0
      ? new Response(stream, { status: 301, headers: { location: '/new' } })
      : new Response('<html>moved</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const out = await fetchSafe('https://acme.test/old');
    assert.equal(out.html, '<html>moved</html>');
    assert.equal(state.cancelled, true);
  });
});

describe('readBody', () => {
  test('truncates text at the cap, rejects binary over it, and handles an empty body', async () => {
    assert.equal(await readBody(new Response('abcdef'), { maxBytes: 4 }), 'abcd');
    assert.equal(await readBody(new Response('abcdef'), { maxBytes: 4, binary: true, overflow: 'reject' }), null);
    assert.deepEqual(await readBody(new Response('abc'), { maxBytes: 4, binary: true }), Buffer.from('abc'));
    assert.equal(await readBody(new Response(null), { maxBytes: 4 }), '');
  });

  test('an abort mid-read rejects (AbortError) instead of returning a short body', async () => {
    const stalled = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('partial')); } }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(() => readBody(stalled, { maxBytes: MB, signal: controller.signal }), (e) => e.name === 'AbortError');
  });
});
