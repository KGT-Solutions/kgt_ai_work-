const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const u = require('../../src/services/voiceUsage');

describe('voiceUsage: estimates and periods', () => {
  test('estimateSeconds is 0 for empty audio and a 1s floor for any clip', () => {
    assert.equal(u.estimateSeconds(0), 0);
    assert.equal(u.estimateSeconds(10), 1); // tiny clip still counts as 1s
    // ~6 KB/s default rate: 60 KB ≈ 10s.
    assert.equal(u.estimateSeconds(60000), 10);
  });
  test('currentPeriod is the UTC YYYY-MM for the moment', () => {
    assert.equal(u.currentPeriod(Date.UTC(2026, 10, 23, 12, 0, 0)), '2026-11');
    assert.equal(u.currentPeriod(Date.UTC(2026, 0, 1, 0, 0, 0)), '2026-01');
  });
});

describe('voiceUsage: cap resolution', () => {
  test('a per-tenant cap wins; 0 means unlimited', () => {
    assert.equal(u.resolveCapSeconds({ voiceMonthlyMinutes: 10 }), 600);
    assert.equal(u.resolveCapSeconds({ voiceMonthlyMinutes: 0 }), 0);
  });
  test('null/absent falls back to the platform default env (unlimited when unset)', () => {
    const prev = process.env.VOICE_MONTHLY_MINUTES_DEFAULT;
    try {
      delete process.env.VOICE_MONTHLY_MINUTES_DEFAULT;
      assert.equal(u.resolveCapSeconds({ voiceMonthlyMinutes: null }), 0);
      assert.equal(u.resolveCapSeconds(null), 0);
      process.env.VOICE_MONTHLY_MINUTES_DEFAULT = '5';
      assert.equal(u.resolveCapSeconds({ voiceMonthlyMinutes: null }), 300);
    } finally {
      if (prev === undefined) delete process.env.VOICE_MONTHLY_MINUTES_DEFAULT;
      else process.env.VOICE_MONTHLY_MINUTES_DEFAULT = prev;
    }
  });
});

describe('voiceUsage: checkVoiceCap (stubbed prisma)', () => {
  const prismaWith = (secondsUsed) => ({
    tenantVoiceUsage: { findUnique: async () => (secondsUsed == null ? null : { secondsUsed }) }
  });

  test('unlimited cap allows without touching the DB', async () => {
    let hit = false;
    const prisma = { tenantVoiceUsage: { findUnique: async () => { hit = true; return null; } } };
    const res = await u.checkVoiceCap({ tenantId: 't1', guardrails: { voiceMonthlyMinutes: 0 }, prisma });
    assert.equal(res.allowed, true);
    assert.equal(res.capSeconds, 0);
    assert.equal(hit, false, 'no usage lookup when unlimited');
  });

  test('allows under the cap and blocks at/over it', async () => {
    const under = await u.checkVoiceCap({ tenantId: 't1', guardrails: { voiceMonthlyMinutes: 10 }, prisma: prismaWith(300) });
    assert.equal(under.allowed, true);
    assert.equal(under.remainingSeconds, 300);
    const over = await u.checkVoiceCap({ tenantId: 't1', guardrails: { voiceMonthlyMinutes: 10 }, prisma: prismaWith(600) });
    assert.equal(over.allowed, false);
    assert.equal(over.remainingSeconds, 0);
  });

  test('fails OPEN when the usage lookup throws', async () => {
    const prisma = { tenantVoiceUsage: { findUnique: async () => { throw new Error('db down'); } } };
    const res = await u.checkVoiceCap({ tenantId: 't1', guardrails: { voiceMonthlyMinutes: 10 }, prisma });
    assert.equal(res.allowed, true, 'a metering outage never silences voice chat');
  });
});

describe('voiceUsage: recordUsage (stubbed prisma)', () => {
  test('upserts the period tally; no write for zero seconds', async () => {
    let args = null;
    const prisma = { tenantVoiceUsage: { upsert: async (a) => { args = a; return {}; } } };
    await u.recordUsage({ tenantId: 't1', seconds: 12, prisma, now: Date.UTC(2026, 10, 23) });
    assert.equal(args.where.tenantId_period.period, '2026-11');
    assert.equal(args.create.secondsUsed, 12);
    assert.deepEqual(args.update.secondsUsed, { increment: 12 });

    args = null;
    await u.recordUsage({ tenantId: 't1', seconds: 0, prisma });
    assert.equal(args, null, 'nothing recorded for a zero-second turn');
  });
});
