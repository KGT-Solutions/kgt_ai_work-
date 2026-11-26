const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { emitTenantEvent, isEvent, buildEvent, EVENTS } = require('../../src/services/integrationEvents');

describe('integrationEvents: catalogue', () => {
  test('known vs unknown events', () => {
    assert.equal(isEvent('lead.created'), true);
    assert.equal(isEvent('nope'), false);
    assert.ok(EVENTS.includes('ticket.created') && EVENTS.includes('chat.session.completed'));
  });
  test('buildEvent wraps data in a signed-shape envelope', () => {
    const env = buildEvent('lead.created', 't1', { email: 'a@b.com' }, { now: 0, id: 'fixed' });
    assert.deepEqual(env, { id: 'fixed', event: 'lead.created', tenantId: 't1', createdAt: new Date(0).toISOString(), data: { email: 'a@b.com' } });
  });
});

describe('integrationEvents: emitTenantEvent', () => {
  test('fans one event out to both webhooks and sheets', async () => {
    const seen = { webhooks: null, sheets: null };
    const deps = {
      webhooks: { emitEvent: async (tid, env) => { seen.webhooks = { tid, event: env.event }; } },
      sheetsSync: { syncEvent: async (tid, env) => { seen.sheets = { tid, event: env.event }; } }
    };
    const res = await emitTenantEvent('t1', 'lead.created', { email: 'x@y.com' }, deps);
    assert.equal(res.delivered, true);
    assert.deepEqual(seen.webhooks, { tid: 't1', event: 'lead.created' });
    assert.deepEqual(seen.sheets, { tid: 't1', event: 'lead.created' });
  });

  test('never rejects even when one integration throws', async () => {
    const deps = {
      webhooks: { emitEvent: async () => { throw new Error('boom'); } },
      sheetsSync: { syncEvent: async () => ({ ok: true }) }
    };
    const res = await emitTenantEvent('t1', 'ticket.created', {}, deps);
    assert.equal(res.delivered, true); // resolved, not rejected
  });

  test('skips unknown events and a missing tenant', async () => {
    let called = false;
    const deps = { webhooks: { emitEvent: async () => { called = true; } }, sheetsSync: { syncEvent: async () => { called = true; } } };
    assert.equal((await emitTenantEvent('t1', 'bogus.event', {}, deps)).delivered, false);
    assert.equal((await emitTenantEvent(null, 'lead.created', {}, deps)).delivered, false);
    assert.equal(called, false);
  });
});
