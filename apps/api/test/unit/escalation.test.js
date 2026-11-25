const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const e = require('../../src/services/escalation');

// Monday 2026-11-23, 10:00 and 20:00 UTC — inside and outside a 09:00–17:00 day.
const MON_10 = new Date('2026-11-23T10:00:00Z');
const MON_20 = new Date('2026-11-23T20:00:00Z');
const SUN_10 = new Date('2026-11-22T10:00:00Z'); // Sunday, no hours configured

const HOURS = { businessTimezone: 'UTC', businessHours: { mon: [['09:00', '17:00']] }, replyEtaMinutes: 30 };

describe('escalation: keyword matching', () => {
  test('matches a configured phrase as a whole word, case-insensitively', () => {
    assert.equal(e.matchTriggerKeyword('I would like a REFUND please', ['refund']), 'refund');
    assert.equal(e.matchTriggerKeyword('cancel my order now', ['cancel my order']), 'cancel my order');
  });
  test('does not match inside a larger word, or when nothing is configured', () => {
    assert.equal(e.matchTriggerKeyword('tell me about agentic ai', ['agent']), null);
    assert.equal(e.matchTriggerKeyword('anything', []), null);
    assert.equal(e.matchTriggerKeyword('anything', null), null);
  });
});

describe('escalation: input validation', () => {
  test('normalizes keywords: trim, lowercase, dedupe, bound', () => {
    const out = e.normalizeKeywords([' Refund ', 'refund', 'Complaint', '', 42]);
    assert.deepEqual(out, ['refund', 'complaint', '42']);
  });
  test('rejects a bad timezone, accepts a good one, and blank clears it', () => {
    assert.throws(() => e.normalizeTimezone('Not/AZone'), /recognised timezone/);
    assert.equal(e.normalizeTimezone('Asia/Kolkata'), 'Asia/Kolkata');
    assert.equal(e.normalizeTimezone(''), null);
  });
  test('validates business hours shape and ordering', () => {
    assert.deepEqual(e.normalizeBusinessHours({ mon: [['09:00', '17:00']] }), { mon: [['09:00', '17:00']] });
    assert.throws(() => e.normalizeBusinessHours({ funday: [['09:00', '10:00']] }), /weekday/);
    assert.throws(() => e.normalizeBusinessHours({ mon: [['17:00', '09:00']] }), /before the close/);
    assert.throws(() => e.normalizeBusinessHours({ mon: [['9', '17']] }), /HH:MM/);
  });
  test('parseEscalationInput rejects an out-of-range ETA', () => {
    assert.throws(() => e.parseEscalationInput({ replyEtaMinutes: 0 }), /replyEtaMinutes/);
    assert.deepEqual(e.parseEscalationInput({ replyEtaMinutes: 30 }).replyEtaMinutes, 30);
    assert.equal(e.parseEscalationInput({ replyEtaMinutes: '' }).replyEtaMinutes, null);
  });
});

describe('escalation: business hours + ETA', () => {
  test('isWithinBusinessHours is true inside the range, false outside and on an unconfigured day', () => {
    assert.equal(e.isWithinBusinessHours(HOURS, MON_10), true);
    assert.equal(e.isWithinBusinessHours(HOURS, MON_20), false);
    assert.equal(e.isWithinBusinessHours(HOURS, SUN_10), false);
  });
  test('computeReplyEta inside hours promises the configured minutes', () => {
    const r = e.computeReplyEta(HOURS, { now: MON_10 });
    assert.equal(r.configured, true);
    assert.equal(r.withinHours, true);
    assert.equal(r.etaMinutes, 30);
    assert.match(r.text, /30 minutes/);
  });
  test('computeReplyEta outside hours uses the off-hours line', () => {
    const r = e.computeReplyEta({ ...HOURS, offHoursEtaText: 'Back Monday 9am.' }, { now: MON_20 });
    assert.equal(r.withinHours, false);
    assert.equal(r.text, 'Back Monday 9am.');
  });
  test('with no business hours configured, nothing is promised', () => {
    const r = e.computeReplyEta({ businessHours: {} }, { now: MON_10 });
    assert.equal(r.configured, false);
    assert.equal(r.text, '');
  });
  test('Hindi ETA is localized', () => {
    const r = e.computeReplyEta(HOURS, { now: MON_10, lang: 'hi' });
    assert.match(r.text, /मिनट/);
  });
});

describe('escalation: persistence helpers (stubbed prisma)', () => {
  test('escalationContextFor returns enabled keywords + ETA sentence, and never throws', async () => {
    const prisma = { tenantEscalationSettings: { findUnique: async () => ({ keywordsEnabled: true, triggerKeywords: ['refund'], ...HOURS }) } };
    const ctx = await e.escalationContextFor('t1', { lang: 'en', now: MON_10, prisma });
    assert.equal(ctx.keywordsEnabled, true);
    assert.deepEqual(ctx.keywords, ['refund']);
    assert.match(ctx.etaSentence, /30 minutes/);

    const boom = { tenantEscalationSettings: { findUnique: async () => { throw new Error('db down'); } } };
    const safe = await e.escalationContextFor('t1', { prisma: boom });
    assert.deepEqual(safe, { keywordsEnabled: false, keywords: [], etaSentence: '' });
  });
  test('disabled keywords are not surfaced to the chat turn', async () => {
    const prisma = { tenantEscalationSettings: { findUnique: async () => ({ keywordsEnabled: false, triggerKeywords: ['refund'] }) } };
    const ctx = await e.escalationContextFor('t1', { prisma });
    assert.equal(ctx.keywordsEnabled, false);
    assert.deepEqual(ctx.keywords, []);
  });
  test('updateEscalationSettings upserts the parsed input and returns a view', async () => {
    let upserted = null;
    const prisma = { tenantEscalationSettings: { upsert: async (args) => { upserted = args; return { ...args.create }; } } };
    const view = await e.updateEscalationSettings('t1', { triggerKeywords: ['Refund', 'refund'], replyEtaMinutes: 15 }, { prisma });
    assert.deepEqual(upserted.create.triggerKeywords, ['refund']);
    assert.equal(upserted.create.replyEtaMinutes, 15);
    assert.equal(view.replyEtaMinutes, 15);
  });
});
