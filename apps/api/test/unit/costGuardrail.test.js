const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../../src/lib/prisma');
const { store } = require('../../src/lib/sharedStore');
const { isTenantOverBudget } = require('../../src/engine/usageTracking');

// Per-tenant monthly spend guardrail (usageTracking.isTenantOverBudget). prisma
// is stubbed; the shared store is the real in-memory driver (reset each test).

function stub(budget, usedTokens) {
  const prevTenant = prisma.tenant.findUnique;
  const prevAgg = prisma.usageLog.aggregate;
  let aggCalls = 0;
  prisma.tenant.findUnique = async () => (budget === undefined ? {} : { monthlyTokenBudget: budget });
  prisma.usageLog.aggregate = async () => {
    aggCalls += 1;
    return { _sum: { promptTokens: usedTokens, completionTokens: 0 } };
  };
  return {
    aggCalls: () => aggCalls,
    restore() { prisma.tenant.findUnique = prevTenant; prisma.usageLog.aggregate = prevAgg; }
  };
}

describe('usageTracking: isTenantOverBudget', () => {
  let savedDefault;
  beforeEach(() => { savedDefault = process.env.DEFAULT_MONTHLY_TOKEN_BUDGET; });
  afterEach(async () => {
    mock.restoreAll();
    if (savedDefault === undefined) delete process.env.DEFAULT_MONTHLY_TOKEN_BUDGET;
    else process.env.DEFAULT_MONTHLY_TOKEN_BUDGET = savedDefault;
    await store().reset();
  });

  test('no tenantId is never over budget', async () => {
    assert.equal(await isTenantOverBudget(null), false);
  });

  test('under a per-tenant budget → false; at/over → true', async () => {
    let s = stub(1000, 500);
    try { assert.equal(await isTenantOverBudget('t1'), false); } finally { s.restore(); }
    await store().reset();
    s = stub(1000, 1000);
    try { assert.equal(await isTenantOverBudget('t2'), true); } finally { s.restore(); }
  });

  test('no per-tenant budget falls back to DEFAULT_MONTHLY_TOKEN_BUDGET', async () => {
    process.env.DEFAULT_MONTHLY_TOKEN_BUDGET = '2000';
    const s = stub(null, 2500); // tenant has no budget of its own
    try { assert.equal(await isTenantOverBudget('t3'), true); } finally { s.restore(); }
  });

  test('no budget anywhere means no cap — and no aggregate query is run', async () => {
    delete process.env.DEFAULT_MONTHLY_TOKEN_BUDGET;
    const s = stub(null, 999999);
    try {
      assert.equal(await isTenantOverBudget('t4'), false);
      assert.equal(s.aggCalls(), 0, 'with no cap, it must not aggregate');
    } finally { s.restore(); }
  });

  test('the decision is cached — a second call does not re-aggregate', async () => {
    const s = stub(1000, 1200);
    try {
      assert.equal(await isTenantOverBudget('t5'), true);
      assert.equal(await isTenantOverBudget('t5'), true);
      assert.equal(s.aggCalls(), 1, 'second call served from the shared-store cache');
    } finally { s.restore(); }
  });

  test('fails OPEN: a DB error returns false so bots stay online', async () => {
    const prev = prisma.tenant.findUnique;
    prisma.tenant.findUnique = async () => { throw new Error('db down'); };
    try { assert.equal(await isTenantOverBudget('t6'), false); } finally { prisma.tenant.findUnique = prev; }
  });
});
