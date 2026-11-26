const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { requestId } = require('../../src/middleware/requestId');
const { getRequestId } = require('../../src/lib/logger');
const { errorHandler } = require('../../src/middleware/errorHandler');

// A throwaway app wired like app.js: requestId FIRST, then routes, errorHandler
// last — so we exercise the real middleware ordering, including that the error
// body picks up the id from the same request.
describe('requestId middleware', () => {
  let server;
  let base;

  before(async () => {
    const app = express();
    app.use(requestId);
    // Echoes what the request sees: req.id, the id visible via the logger's
    // async context (they must agree), and any recorded inbound client id.
    app.get('/whoami', (req, res) => res.json({
      id: req.id,
      ctxId: getRequestId(),
      clientId: req.clientRequestId ?? null,
    }));
    app.get('/boom', () => { throw new Error('kaboom'); });
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  test('mints an id, exposes it on req.id, and echoes it as X-Request-Id', async () => {
    const res = await fetch(`${base}/whoami`);
    const header = res.headers.get('x-request-id');
    const body = await res.json();
    assert.ok(header && header.length > 0, 'header present');
    assert.equal(body.id, header, 'req.id matches the echoed header');
    assert.equal(body.ctxId, header, 'logger context carries the same id');
  });

  test('two requests get distinct ids', async () => {
    const a = (await fetch(`${base}/whoami`)).headers.get('x-request-id');
    const b = (await fetch(`${base}/whoami`)).headers.get('x-request-id');
    assert.notEqual(a, b);
  });

  test('always mints its own id; a sane inbound id is recorded, not adopted', async () => {
    const res = await fetch(`${base}/whoami`, { headers: { 'X-Request-Id': 'trace-abc_123.4' } });
    const header = res.headers.get('x-request-id');
    const body = await res.json();
    // The authoritative id is freshly minted, NOT the client's value.
    assert.notEqual(header, 'trace-abc_123.4');
    assert.equal(body.id, header);
    // The client's value is preserved separately so the two can still be joined.
    assert.equal(body.clientId, 'trace-abc_123.4');
  });

  test('ignores an unsafe inbound id entirely (not even recorded)', async () => {
    // Contains a space (outside the safe charset) -> not adopted, not recorded.
    const res = await fetch(`${base}/whoami`, { headers: { 'X-Request-Id': 'bad id with spaces' } });
    const header = res.headers.get('x-request-id');
    const body = await res.json();
    assert.notEqual(header, 'bad id with spaces');
    assert.ok(/^[A-Za-z0-9._-]+$/.test(header), 'minted id is in the safe charset');
    assert.equal(body.clientId, null, 'an unsafe inbound id is dropped, not recorded');
  });

  test('ignores an over-long inbound id', async () => {
    const huge = 'a'.repeat(200);
    const res = await fetch(`${base}/whoami`, { headers: { 'X-Request-Id': huge } });
    const body = await res.json();
    assert.notEqual(res.headers.get('x-request-id'), huge);
    assert.equal(body.clientId, null);
  });

  test('a 500 body carries the request id, matching the response header', async () => {
    const res = await fetch(`${base}/boom`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Internal server error');
    assert.equal(body.requestId, res.headers.get('x-request-id'));
  });
});
