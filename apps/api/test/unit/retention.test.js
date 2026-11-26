const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const r = require('../../src/services/retention');

const NOW = new Date('2026-11-23T00:00:00Z').getTime();

afterEach(() => {
  delete process.env.CHAT_RETENTION_DAYS;
  delete process.env.CHAT_RETENTION_REDACT_LEAD_SUMMARY;
});

describe('retention: fixed server policy', () => {
  test('defaults to 30 days', () => {
    assert.equal(r.serverRetentionDays(), 30);
    assert.equal(r.DEFAULT_RETENTION_DAYS, 30);
  });
  test('operator override is honoured and clamped into [MIN, MAX]', () => {
    process.env.CHAT_RETENTION_DAYS = '45';
    assert.equal(r.serverRetentionDays(), 45);
    process.env.CHAT_RETENTION_DAYS = '0'; // sub-floor → ignored, back to default
    assert.equal(r.serverRetentionDays(), 30);
    process.env.CHAT_RETENTION_DAYS = '999999'; // over max → clamped
    assert.equal(r.serverRetentionDays(), r.MAX_RETENTION_DAYS);
    process.env.CHAT_RETENTION_DAYS = 'abc'; // junk → default
    assert.equal(r.serverRetentionDays(), 30);
  });
  test('getRetentionSettings reports a fixed, non-editable 30-day policy', async () => {
    const prisma = { tenantRetentionSettings: { findUnique: async () => ({ lastPurgeAt: new Date(NOW), lastPurgedCount: 3 }) } };
    const view = await r.getRetentionSettings('t1', { prisma });
    assert.equal(view.retentionDays, 30);
    assert.equal(view.fixed, true);
    assert.equal(view.editable, false);
    assert.equal(view.selfHostContact, true);
    assert.equal(view.lastPurgedCount, 3);
  });
  test('parseRetentionInput / updateRetentionSettings are gone (no user config)', () => {
    assert.equal(r.parseRetentionInput, undefined);
    assert.equal(r.updateRetentionSettings, undefined);
  });
  test('cutoffFor subtracts the right number of days', () => {
    assert.equal(r.cutoffFor(30, NOW).toISOString(), '2026-10-24T00:00:00.000Z');
  });
  test('leadsToRedactWhere targets old leads that still carry a transcript', () => {
    const cutoff = r.cutoffFor(30, NOW);
    const where = r.leadsToRedactWhere('t1', cutoff);
    assert.equal(where.tenantId, 't1');
    assert.deepEqual(where.createdAt, { lt: cutoff });
    // Only non-empty transcripts are matched → the sweep is idempotent.
    assert.deepEqual(where.NOT, { fullTranscript: { equals: [] } });
  });
});

describe('retention: purgeTenant (fixed window)', () => {
  // `eligible` = chat sessions past the window; `leads` = leads whose transcript
  // is still populated and past the window.
  const makePrisma = (eligible, leads = 0) => {
    const state = { deletedWhere: null, upserted: null, leadWhere: null, leadData: null };
    return {
      state,
      tenantRetentionSettings: {
        upsert: async (args) => { state.upserted = args; return {}; }
      },
      chatSession: {
        count: async () => eligible,
        deleteMany: async (args) => { state.deletedWhere = args.where; return { count: eligible }; }
      },
      lead: {
        count: async (args) => { state.leadWhere = args.where; return leads; },
        updateMany: async (args) => { state.leadWhere = args.where; state.leadData = args.data; return { count: leads }; }
      }
    };
  };

  test('dry-run counts old sessions and lead transcripts but changes nothing', async () => {
    const prisma = makePrisma(7, 3);
    const res = await r.purgeTenant('t1', { prisma, now: NOW, dryRun: true });
    assert.equal(res.purged, false);
    assert.equal(res.eligible, 7);
    assert.equal(res.deleted, 0);
    assert.equal(res.leadsEligible, 3);
    assert.equal(res.leadsRedacted, 0);
    assert.equal(res.retentionDays, 30);
    assert.equal(res.cutoff, '2026-10-24T00:00:00.000Z');
    assert.equal(prisma.state.deletedWhere, null);
    assert.equal(prisma.state.leadData, null); // no update performed
  });

  test('real purge deletes sessions and redacts lead transcripts, keeping the summary', async () => {
    const prisma = makePrisma(4, 2);
    const res = await r.purgeTenant('t1', { prisma, now: NOW, dryRun: false });
    assert.equal(res.purged, true);
    assert.equal(res.deleted, 4);
    assert.equal(res.leadsRedacted, 2);
    assert.equal(prisma.state.deletedWhere.tenantId, 't1');
    assert.ok(Array.isArray(prisma.state.deletedWhere.OR));
    // Lead transcript emptied, scoped to the tenant, summary left intact by default.
    assert.equal(prisma.state.leadWhere.tenantId, 't1');
    assert.deepEqual(prisma.state.leadData.fullTranscript, []);
    assert.equal('chatSummary' in prisma.state.leadData, false);
    assert.equal(prisma.state.upserted.create.tenantId, 't1');
    assert.equal(prisma.state.upserted.update.lastPurgedCount, 4);
  });

  test('CHAT_RETENTION_REDACT_LEAD_SUMMARY=true also clears the summary', async () => {
    process.env.CHAT_RETENTION_REDACT_LEAD_SUMMARY = 'true';
    const prisma = makePrisma(0, 5);
    await r.purgeTenant('t1', { prisma, now: NOW, dryRun: false });
    assert.equal(prisma.state.leadData.chatSummary, null);
    assert.deepEqual(prisma.state.leadData.fullTranscript, []);
  });

  test('a lead-redaction failure never blocks the conversation purge', async () => {
    const prisma = makePrisma(4, 2);
    prisma.lead.updateMany = async () => { throw new Error('json filter unsupported'); };
    const res = await r.purgeTenant('t1', { prisma, now: NOW, dryRun: false });
    assert.equal(res.deleted, 4); // sessions still purged
    assert.equal(res.leadsRedacted, 0); // redaction degraded to zero
    assert.equal(prisma.state.deletedWhere.tenantId, 't1');
  });

  test('ignores any legacy per-tenant setting — the window is always the server policy', async () => {
    process.env.CHAT_RETENTION_DAYS = '10';
    const prisma = makePrisma(2, 0);
    const res = await r.purgeTenant('t1', { prisma, now: NOW, dryRun: true });
    assert.equal(res.retentionDays, 10);
    assert.equal(res.cutoff, '2026-11-13T00:00:00.000Z');
  });
});

describe('retention: sweep (all tenants)', () => {
  test('purges every tenant, redacts lead transcripts, and tallies both', async () => {
    const deleted = {};
    const prisma = {
      tenant: { findMany: async () => [{ id: 'a' }, { id: 'b' }] },
      tenantRetentionSettings: { upsert: async () => ({}) },
      chatSession: {
        count: async () => 2,
        deleteMany: async (args) => { deleted[args.where.tenantId] = 2; return { count: 2 }; }
      },
      lead: {
        count: async () => 1,
        updateMany: async () => ({ count: 1 })
      }
    };
    const res = await r.runRetentionSweep({ prisma, now: NOW });
    assert.equal(res.tenants, 2);
    assert.equal(res.deleted, 4);
    assert.equal(res.leadsRedacted, 2);
    assert.deepEqual(deleted, { a: 2, b: 2 });
  });

  test('sweep survives a per-tenant failure', async () => {
    const prisma = {
      tenant: { findMany: async () => [{ id: 'a' }, { id: 'b' }] },
      tenantRetentionSettings: { upsert: async () => ({}) },
      chatSession: {
        count: async ({ where }) => { if (where.tenantId === 'a') throw new Error('boom'); return 1; },
        deleteMany: async () => ({ count: 1 })
      },
      lead: { count: async () => 0, updateMany: async () => ({ count: 0 }) }
    };
    const res = await r.runRetentionSweep({ prisma, now: NOW });
    assert.equal(res.tenants, 2);
    assert.equal(res.deleted, 1); // 'a' failed, 'b' succeeded
  });

  test('sweep returns zero when tenants cannot be listed', async () => {
    const prisma = { tenant: { findMany: async () => { throw new Error('db down'); } } };
    const res = await r.runRetentionSweep({ prisma, now: NOW });
    assert.deepEqual(res, { tenants: 0, deleted: 0, leadsRedacted: 0 });
  });
});
