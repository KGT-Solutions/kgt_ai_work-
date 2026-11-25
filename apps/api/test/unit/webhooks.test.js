// Env must be set before requiring the service (it reads these at module load).
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-webhooks';
process.env.WEBHOOK_RETRY_DELAYS_MS = '1,1'; // near-instant retries so tests stay fast
delete process.env.CRAWLER_ALLOW_PRIVATE_HOSTS; // the SSRF guard must be active

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const webhooks = require('../../src/services/webhooks');
const { WebhookError, signPayload, validateUrl, createWebhook, emitEvent, deliverWithRetry } = webhooks;

// A fake prisma that records what the service wrote.
function makePrisma(existing = []) {
  const rows = [...existing];
  const calls = { created: [], deliveries: [], webhookUpdates: [] };
  return {
    calls, rows,
    tenantWebhook: {
      count: async ({ where }) => rows.filter((r) => r.tenantId === where.tenantId).length,
      findMany: async ({ where }) => rows.filter((r) =>
        r.tenantId === where.tenantId &&
        (where.enabled === undefined || r.enabled === where.enabled) &&
        (!where.events?.has || (r.events || []).includes(where.events.has))),
      findFirst: async ({ where }) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) || null,
      create: async ({ data }) => { const row = { id: `wh-${rows.length + 1}`, ...data }; rows.push(row); calls.created.push(row); return row; },
      update: async ({ where, data }) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); calls.webhookUpdates.push({ where, data }); return row; }
    },
    webhookDelivery: {
      create: async ({ data }) => { calls.deliveries.push(data); return { id: `d-${calls.deliveries.length}`, ...data }; }
    }
  };
}

// A fetch stub: given a queue of responses/errors, returns/throws them in order.
function fetchSeq(steps) {
  let i = 0;
  return async () => {
    const step = steps[Math.min(i, steps.length - 1)]; i += 1;
    if (step instanceof Error) throw step;
    return { status: step, text: async () => '' };
  };
}

describe('webhooks: signPayload', () => {
  test('is a stable HMAC-SHA256 of `${ts}.${body}`', () => {
    const sig = signPayload('secret', 123, '{"a":1}');
    const expected = crypto.createHmac('sha256', 'secret').update('123.{"a":1}').digest('hex');
    assert.equal(sig, expected);
    assert.equal(signPayload('secret', 123, '{"a":1}'), sig); // stable
    assert.notEqual(signPayload('other', 123, '{"a":1}'), sig); // key-sensitive
  });
});

describe('webhooks: validateUrl (SSRF + shape)', () => {
  test('accepts public http(s) URLs', () => {
    assert.equal(validateUrl('https://example.com/hook'), 'https://example.com/hook');
  });
  test('rejects non-http(s) and private IP literals and junk', () => {
    assert.throws(() => validateUrl('ftp://example.com'), WebhookError);
    assert.throws(() => validateUrl('javascript:alert(1)'), WebhookError);
    assert.throws(() => validateUrl('http://127.0.0.1/x'), WebhookError);     // loopback
    assert.throws(() => validateUrl('http://169.254.169.254/latest'), WebhookError); // cloud metadata
    assert.throws(() => validateUrl('http://192.168.0.5/x'), WebhookError);   // RFC1918
    assert.throws(() => validateUrl('not a url'), WebhookError);
    assert.throws(() => validateUrl(''), WebhookError);
  });
});

describe('webhooks: createWebhook', () => {
  test('stores the secret encrypted, returns it once, and validates events', async () => {
    const prisma = makePrisma();
    const created = await createWebhook('t1', { url: 'https://example.com/h', events: ['lead.created', 'ticket.created'] }, { prisma });
    assert.match(created.secret, /^whsec_/);         // plaintext returned once
    assert.equal(created.secretSet, true);
    assert.equal(prisma.calls.created[0].secret.startsWith('v1:'), true); // stored encrypted, not plaintext
    assert.notEqual(prisma.calls.created[0].secret, created.secret);
    assert.deepEqual(created.events, ['lead.created', 'ticket.created']);
  });
  test('rejects unknown events and an empty subscription', async () => {
    const prisma = makePrisma();
    await assert.rejects(() => createWebhook('t1', { url: 'https://e.com', events: ['nope'] }, { prisma }), WebhookError);
    await assert.rejects(() => createWebhook('t1', { url: 'https://e.com', events: [] }, { prisma }), WebhookError);
  });
  test('enforces the per-tenant maximum', async () => {
    const existing = Array.from({ length: webhooks.MAX_WEBHOOKS_PER_TENANT }, (_, i) => ({ id: `w${i}`, tenantId: 't1' }));
    const prisma = makePrisma(existing);
    await assert.rejects(() => createWebhook('t1', { url: 'https://e.com', events: ['lead.created'] }, { prisma }),
      (e) => e instanceof WebhookError && e.statusCode === 409);
  });
});

describe('webhooks: deliverWithRetry', () => {
  const base = { secret: 's', body: '{}', event: 'ping', deliveryId: 'd', now: Date.now() };
  test('a 2xx succeeds on the first attempt', async () => {
    const out = await deliverWithRetry('https://e.com', { ...base, fetchImpl: fetchSeq([200]) });
    assert.equal(out.ok, true); assert.equal(out.attempts, 1); assert.equal(out.statusCode, 200);
  });
  test('a transient 500 is retried, then succeeds', async () => {
    const out = await deliverWithRetry('https://e.com', { ...base, fetchImpl: fetchSeq([500, 500, 200]) });
    assert.equal(out.ok, true); assert.equal(out.attempts, 3);
  });
  test('a 4xx is not retried', async () => {
    const out = await deliverWithRetry('https://e.com', { ...base, fetchImpl: fetchSeq([400, 200]) });
    assert.equal(out.ok, false); assert.equal(out.attempts, 1); assert.equal(out.statusCode, 400);
  });
  test('an EPRIVATE connection error is not retried', async () => {
    const out = await deliverWithRetry('https://e.com', { ...base, fetchImpl: fetchSeq([Object.assign(new Error('blocked'), { code: 'EPRIVATE' })]) });
    assert.equal(out.ok, false); assert.equal(out.attempts, 1); assert.equal(out.statusCode, null);
  });
});

describe('webhooks: emitEvent', () => {
  test('delivers only to enabled webhooks subscribed to the event, and logs each', async () => {
    const prisma = makePrisma([
      { id: 'wh1', tenantId: 't1', url: 'https://a.com', enabled: true, events: ['lead.created'], secret: null },
      { id: 'wh2', tenantId: 't1', url: 'https://b.com', enabled: true, events: ['ticket.created'], secret: null },
      { id: 'wh3', tenantId: 't1', url: 'https://c.com', enabled: false, events: ['lead.created'], secret: null }
    ]);
    const envelope = { id: 'ev1', event: 'lead.created', tenantId: 't1', createdAt: new Date().toISOString(), data: { email: 'x@y.com' } };
    const res = await emitEvent('t1', envelope, { prisma, fetchImpl: fetchSeq([200]), now: Date.now() });
    assert.equal(res.delivered, 1);   // only wh1 matches (wh2 wrong event, wh3 disabled)
    assert.equal(res.total, 1);
    assert.equal(prisma.calls.deliveries.length, 1);
    assert.equal(prisma.calls.deliveries[0].status, 'success');
    assert.equal(prisma.calls.deliveries[0].webhookId, 'wh1');
  });

  test('a failed delivery is logged as failed and never throws', async () => {
    const prisma = makePrisma([{ id: 'wh1', tenantId: 't1', url: 'https://a.com', enabled: true, events: ['lead.created'], secret: null }]);
    const envelope = { id: 'ev2', event: 'lead.created', tenantId: 't1', createdAt: new Date().toISOString(), data: {} };
    const res = await emitEvent('t1', envelope, { prisma, fetchImpl: fetchSeq([500]), now: Date.now() });
    assert.equal(res.delivered, 0);
    assert.equal(prisma.calls.deliveries[0].status, 'failed');
    assert.equal(prisma.calls.webhookUpdates[0].data.lastStatus, 'failed');
  });

  test('no matching webhooks is a clean no-op', async () => {
    const prisma = makePrisma([]);
    const res = await emitEvent('t1', { id: 'e', event: 'lead.created', tenantId: 't1', createdAt: '', data: {} }, { prisma });
    assert.deepEqual(res, { delivered: 0 });
  });
});
