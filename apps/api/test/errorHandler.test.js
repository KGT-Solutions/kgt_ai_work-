const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { errorHandler } = require('../src/middleware/errorHandler');

// A throwaway app wired like app.js (body parser first, errorHandler last),
// so the errors under test are body-parser's real ones, not hand-built fakes.
describe('errorHandler — status codes', () => {
  let server;
  let base;
  const logged = [];
  const realConsoleError = console.error;

  before(async () => {
    console.error = (...args) => logged.push(args);
    const app = express();
    app.use(express.json({ limit: '1kb' }));
    app.post('/echo', (req, res) => res.json({ ok: true }));
    app.get('/boom', () => { throw new Error('database exploded'); });
    app.get('/bad-parse', () => { JSON.parse('{not json'); }); // our own bug, not client input
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    console.error = realConsoleError;
    server.close();
  });

  test('oversized JSON body -> 413', async () => {
    const res = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(5000) })
    });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'Request body is too large' });
  });

  test('malformed JSON body -> 400', async () => {
    const res = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": '
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Malformed request body — expected valid JSON' });
  });

  test('valid body still reaches the route', async () => {
    const res = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}'
    });
    assert.equal(res.status, 200);
  });

  test('unhandled server error -> generic 500, logged, no internals leaked', async () => {
    logged.length = 0;
    const res = await fetch(`${base}/boom`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { error: 'Internal server error' });
    assert.equal(logged.length, 1);
  });

  test('a SyntaxError from our own code stays a 500 (not mistaken for bad client JSON)', async () => {
    const res = await fetch(`${base}/bad-parse`);
    assert.equal(res.status, 500);
  });
});
