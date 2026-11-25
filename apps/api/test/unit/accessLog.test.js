const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { requestId } = require('../../src/middleware/requestId');
const { accessLog } = require('../../src/middleware/accessLog');

// A throwaway app wired like app.js: requestId first, then accessLog, so the
// finish-time line carries the same id the response header does. LOG_FORMAT=json
// so we can parse the emitted line.
let out;
const realLog = console.log;
const realError = console.error;
const savedEnv = {};
const ENV_KEYS = ['LOG_LEVEL', 'LOG_FORMAT', 'NODE_ENV', 'ACCESS_LOG_ENABLED'];

beforeEach(() => {
  out = { log: [], error: [] };
  console.log = (...a) => out.log.push(a.join(' '));
  console.error = (...a) => out.error.push(a.join(' '));
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.LOG_FORMAT = 'json';
  process.env.LOG_LEVEL = 'info';
  delete process.env.NODE_ENV;
  delete process.env.ACCESS_LOG_ENABLED;
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('accessLog middleware', () => {
  let server;
  let base;

  before(async () => {
    const app = express();
    app.use(requestId);
    app.use(accessLog);
    app.get('/health', (req, res) => res.json({ ok: true }));
    app.get('/ok', (req, res) => res.json({ ok: true }));
    app.get('/secret', (req, res) => res.status(200).json({ ok: true }));
    app.get('/nope', (req, res) => res.status(404).json({ error: 'no' }));
    app.get('/boom', (req, res) => res.status(500).json({ error: 'boom' }));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  // The 'finish' event fires just after the client has the full body; give the
  // event loop a tick so the listener has run before we assert.
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const lines = () => [...out.log, ...out.error].map((l) => JSON.parse(l));

  test('logs one line per request with method/path/status/duration and reqId', async () => {
    const res = await fetch(`${base}/ok`);
    await tick();
    const reqLines = lines().filter((l) => l.msg === 'request');
    assert.equal(reqLines.length, 1);
    const l = reqLines[0];
    assert.equal(l.method, 'GET');
    assert.equal(l.path, '/ok');
    assert.equal(l.status, 200);
    assert.equal(typeof l.durationMs, 'number');
    assert.equal(l.reqId, res.headers.get('x-request-id'), 'line is correlated with the response id');
  });

  test('never logs the query string (no token leak), only the path', async () => {
    await fetch(`${base}/secret?token=super-secret-xyz`);
    await tick();
    const l = lines().find((x) => x.msg === 'request');
    assert.equal(l.path, '/secret');
    assert.ok(!JSON.stringify(l).includes('super-secret-xyz'));
  });

  test('a 5xx is still a single info access line (the error detail is logged elsewhere)', async () => {
    out.log.length = 0; out.error.length = 0;
    await fetch(`${base}/boom`);
    await tick();
    const l = out.log.map((x) => JSON.parse(x)).find((x) => x.msg === 'request');
    assert.ok(l, 'request line went to stdout at info');
    assert.equal(l.status, 500);
    assert.equal(l.level, 'info');
    // Not duplicated onto stderr as a second error for the same request.
    assert.equal(out.error.filter((x) => JSON.parse(x).msg === 'request').length, 0);
  });

  test('a 4xx stays at info level', async () => {
    out.log.length = 0; out.error.length = 0;
    await fetch(`${base}/nope`);
    await tick();
    const l = out.log.map((x) => JSON.parse(x)).find((x) => x.msg === 'request');
    assert.equal(l.status, 404);
    assert.equal(l.level, 'info');
  });

  test('logs exactly one line per request even though both finish and close fire', async () => {
    out.log.length = 0; out.error.length = 0;
    await fetch(`${base}/ok`);
    await tick();
    assert.equal(lines().filter((l) => l.msg === 'request').length, 1);
  });

  test('skips /health', async () => {
    out.log.length = 0; out.error.length = 0;
    await fetch(`${base}/health`);
    await tick();
    assert.equal(lines().filter((l) => l.msg === 'request').length, 0);
  });

  test('ACCESS_LOG_ENABLED=false turns it off', async () => {
    process.env.ACCESS_LOG_ENABLED = 'false';
    out.log.length = 0; out.error.length = 0;
    await fetch(`${base}/ok`);
    await tick();
    assert.equal(lines().filter((l) => l.msg === 'request').length, 0);
  });
});
