const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// services/errorAlerts.js: operator alerts for server-side failures, throttled.
// mailer.sendMail is mocked (via the module object, which is how errorAlerts
// calls it), so nothing connects anywhere and we can inspect what would go out.
const mailer = require('../../src/services/mailer');
const { runWithRequestContext } = require('../../src/lib/logger');
const {
  notifyError, recipients, signature, resetErrorAlertThrottle,
} = require('../../src/services/errorAlerts');

const ENV_KEYS = ['ERROR_ALERT_EMAIL', 'ERROR_ALERTS_ENABLED', 'ERROR_ALERT_DEDUP_MIN', 'ERROR_ALERT_MAX_PER_HOUR', 'NODE_ENV', 'DEPLOY_ENV'];
const savedEnv = {};

let sent;
let sendMock;

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  // A configured operator inbox by default; individual tests clear it to check
  // the no-op path.
  process.env.ERROR_ALERT_EMAIL = 'ops@example.com';
  await resetErrorAlertThrottle();

  sent = [];
  sendMock = mock.method(mailer, 'sendMail', async (msg) => { sent.push(msg); return { sent: true, via: 'smtp' }; });
  // Silence the service's own info/warn logging during tests.
  mock.method(console, 'log', () => {});
  mock.method(console, 'warn', () => {});
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('errorAlerts — gating', () => {
  test('no-op (never touches the mailer) when no ERROR_ALERT_EMAIL is set', async () => {
    delete process.env.ERROR_ALERT_EMAIL;
    const r = await notifyError(new Error('boom'), { source: 'http-500' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'no-recipient');
    assert.equal(sendMock.mock.callCount(), 0);
  });

  test('disabled by ERROR_ALERTS_ENABLED=false even with a recipient set', async () => {
    process.env.ERROR_ALERTS_ENABLED = 'false';
    const r = await notifyError(new Error('boom'), { source: 'http-500' });
    assert.equal(r.reason, 'disabled');
    assert.equal(sendMock.mock.callCount(), 0);
  });

  test('ignores malformed addresses and keeps the valid ones', () => {
    process.env.ERROR_ALERT_EMAIL = 'not-an-email, a@b.com ; c@d.com';
    assert.deepEqual(recipients(), ['a@b.com', 'c@d.com']);
  });

  test('caps the recipient list at five', () => {
    process.env.ERROR_ALERT_EMAIL = Array.from({ length: 8 }, (_, i) => `op${i}@x.com`).join(',');
    assert.equal(recipients().length, 5);
  });

  test('collapses duplicate addresses', () => {
    process.env.ERROR_ALERT_EMAIL = 'a@b.com, a@b.com ; A@B.com';
    assert.deepEqual(recipients(), ['a@b.com']);
  });
});

describe('errorAlerts — sending', () => {
  test('sends one email to the operators with a descriptive subject', async () => {
    process.env.ERROR_ALERT_EMAIL = 'a@b.com, c@d.com';
    const r = await notifyError(new Error('database is on fire'), { source: 'http-500' });
    assert.equal(r.sent, true);
    assert.equal(sendMock.mock.callCount(), 1);
    const msg = sent[0];
    assert.deepEqual(msg.to, ['a@b.com', 'c@d.com']);
    assert.ok(msg.subject.includes('http-500'));
    assert.ok(msg.subject.includes('database is on fire'));
    assert.ok(msg.text.includes('database is on fire'));
    assert.ok(msg.label.includes('error alert'));
  });

  test('includes the request id and path when a request is given', async () => {
    await notifyError(new Error('kaboom'), { source: 'http-500', req: { id: 'req-42', method: 'POST', originalUrl: '/api/chat' } });
    const msg = sent[0];
    assert.ok(msg.text.includes('req-42'), 'request id in the body');
    assert.ok(msg.text.includes('POST /api/chat'), 'method + path in the body');
  });

  test('strips the query string from the reported path (no token leak)', async () => {
    await notifyError(new Error('kaboom'), {
      source: 'http-500',
      req: { method: 'GET', originalUrl: '/api/reset?token=super-secret-123' },
    });
    const msg = sent[0];
    assert.ok(msg.text.includes('GET /api/reset'), 'path kept');
    assert.ok(!msg.text.includes('super-secret-123'), 'query string (and its token) dropped');
  });

  test('picks up the request id from the async context when no req is passed', async () => {
    await runWithRequestContext({ reqId: 'ctx-99' }, async () => {
      await notifyError(new Error('from context'), { source: 'http-500' });
    });
    assert.ok(sent[0].text.includes('ctx-99'));
  });

  test('a non-Error value is still reportable', async () => {
    const r = await notifyError('a bare string rejection', { source: 'unhandledRejection' });
    assert.equal(r.sent, true);
    assert.ok(sent[0].text.includes('a bare string rejection'));
  });
});

describe('errorAlerts — throttling', () => {
  test('dedups a repeated identical error within the window', async () => {
    const make = () => { const e = new Error('same failure'); e.stack = 'Error: same failure\n    at f (/app/x.js:1:1)'; return e; };
    const first = await notifyError(make(), { source: 'http-500' });
    const second = await notifyError(make(), { source: 'http-500' });
    assert.equal(first.sent, true);
    assert.equal(second.reason, 'deduped');
    assert.equal(sendMock.mock.callCount(), 1, 'only the first of an identical pair is sent');
  });

  test('dedups errors that differ only in volatile ids/numbers in the message', async () => {
    // Same failure, same frame, message differs only by a record id — should
    // collapse to a single alert rather than one per occurrence.
    const at = '\n    at load (/app/db.js:7:3)';
    const e1 = new Error('record 4821 not found'); e1.stack = `Error: record 4821 not found${at}`;
    const e2 = new Error('record 9140 not found'); e2.stack = `Error: record 9140 not found${at}`;
    await notifyError(e1, { source: 'http-500' });
    const second = await notifyError(e2, { source: 'http-500' });
    assert.equal(second.reason, 'deduped');
    assert.equal(sendMock.mock.callCount(), 1);
  });

  test('distinct errors are not deduped against each other', async () => {
    await notifyError(new Error('error one'), { source: 'http-500' });
    await notifyError(new Error('error two'), { source: 'http-500' });
    assert.equal(sendMock.mock.callCount(), 2);
  });

  test('the hourly cap bounds a storm of distinct errors', async () => {
    process.env.ERROR_ALERT_MAX_PER_HOUR = '2';
    // Distinct messages (no shared template) so each is its own signature.
    const r1 = await notifyError(new Error('alpha failure'), { source: 'http-500' });
    const r2 = await notifyError(new Error('bravo failure'), { source: 'http-500' });
    const r3 = await notifyError(new Error('charlie failure'), { source: 'http-500' });
    assert.equal(r1.sent, true);
    assert.equal(r2.sent, true);
    assert.equal(r3.reason, 'throttled');
    assert.equal(sendMock.mock.callCount(), 2);
  });

  test('hitting the cap does not consume a signature\'s dedup slot', async () => {
    // Same pinned stack both times so the two calls share a signature; with the
    // cap at zero the first is throttled BEFORE the dedup slot is claimed, so
    // raising the cap lets that same signature through afterwards.
    const held = () => { const e = new Error('held'); e.stack = 'Error: held\n    at h (/app/h.js:3:1)'; return e; };
    process.env.ERROR_ALERT_MAX_PER_HOUR = '0';
    const throttled = await notifyError(held(), { source: 'http-500' });
    assert.equal(throttled.reason, 'throttled');
    process.env.ERROR_ALERT_MAX_PER_HOUR = '10';
    const nowSent = await notifyError(held(), { source: 'http-500' });
    assert.equal(nowSent.sent, true, 'the signature was never burned while capped');
  });
});

describe('errorAlerts — resilience', () => {
  test('never throws, even if the mailer itself throws', async () => {
    sendMock.mock.mockImplementation(async () => { throw new Error('mailer exploded'); });
    const r = await notifyError(new Error('boom'), { source: 'http-500' });
    assert.equal(r.reason, 'exception');
  });

  test('signature is stable for the same error and differs by source', () => {
    const e = new Error('x'); e.stack = 'Error: x\n    at g (/app/y.js:2:2)';
    assert.equal(signature('http-500', e), signature('http-500', e));
    assert.notEqual(signature('http-500', e), signature('uncaughtException', e));
  });
});
