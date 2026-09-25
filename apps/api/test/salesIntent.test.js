const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { classifyQuery } = require('../src/services/salesbot/intent');

describe('classifyQuery — objection detection', () => {
  test('detects a payment-gateway-lag objection', () => {
    const r = classifyQuery('Your competitor settlement is so slow, payments take days to reconcile');
    assert.ok(r.objectionTags.includes('objection:payment_gateway_lag'));
  });

  test('detects an adoption-friction objection', () => {
    const r = classifyQuery('Our senior citizen residents are not tech savvy, they wont use another app');
    assert.ok(r.objectionTags.includes('objection:adoption_friction'));
  });

  test('detects a spreadsheet-migration objection', () => {
    const r = classifyQuery('We currently track everything in an excel spreadsheet, is migration hard?');
    assert.ok(r.objectionTags.includes('objection:spreadsheet_migration'));
  });

  test('detects a pricing objection', () => {
    const r = classifyQuery('This seems pretty expensive, what is the pricing?');
    assert.ok(r.objectionTags.includes('objection:pricing'));
  });

  test('a query can raise multiple objections at once', () => {
    const r = classifyQuery('It is expensive and our residents are not tech savvy');
    assert.ok(r.objectionTags.includes('objection:pricing'));
    assert.ok(r.objectionTags.includes('objection:adoption_friction'));
    assert.equal(r.objectionTags.length, 2);
  });

  test('a plain informational question raises no objection', () => {
    const r = classifyQuery('What does FLATBRIZ do?');
    assert.deepEqual(r.objectionTags, []);
  });
});

describe('classifyQuery — competitor detection', () => {
  test('detects MyGate by name, with or without a space', () => {
    assert.ok(classifyQuery('How do you compare to MyGate?').competitorTags.includes('competitor:mygate'));
    assert.ok(classifyQuery('how do you compare to my gate').competitorTags.includes('competitor:mygate'));
  });

  test('detects NoBroker by name, with or without a space', () => {
    assert.ok(classifyQuery('We currently use NoBroker').competitorTags.includes('competitor:nobroker'));
    assert.ok(classifyQuery('we use no broker today').competitorTags.includes('competitor:nobroker'));
  });

  test('is case-insensitive', () => {
    assert.ok(classifyQuery('MYGATE is what we use').competitorTags.includes('competitor:mygate'));
  });
});

describe('classifyQuery — buying signals and intent scoring', () => {
  test('a buying-signal phrase is detected', () => {
    const r = classifyQuery('How do we get started with onboarding?');
    assert.ok(r.buyingSignals.includes('onboard') || r.buyingSignals.includes('onboarding') || r.buyingSignals.includes('get started'));
  });

  test('score = 2 (baseline) for a plain non-empty question with no signals', () => {
    const r = classifyQuery('What does FLATBRIZ do?');
    assert.equal(r.intentScore, 2);
  });

  test('an empty query scores zero and is not high intent', () => {
    const r = classifyQuery('');
    assert.equal(r.intentScore, 0);
    assert.equal(r.isHighIntent, false);
  });

  test('a single buying signal (15) plus baseline (2) totals 17, below the default 40 threshold', () => {
    const r = classifyQuery('Can we book a call?');
    assert.equal(r.intentScore, 17);
    assert.equal(r.isHighIntent, false);
  });

  test('score saturates at 100 and never exceeds it', () => {
    const r = classifyQuery(
      'sign up demo trial onboarding contract timeline implementation pilot rollout proposal ' +
      'expensive cost pricing mygate nobroker excel spreadsheet senior citizen'
    );
    assert.ok(r.intentScore <= 100);
  });

  test('multiple buying signals clear the default 40 threshold and flip isHighIntent', () => {
    const r = classifyQuery('We want a demo, then a trial, then to discuss the contract and timeline');
    assert.ok(r.intentScore >= 40, `expected >= 40, got ${r.intentScore}`);
    assert.equal(r.isHighIntent, true);
  });
});

describe('classifyQuery — INTENT_SCORE_THRESHOLD is read from the environment', () => {
  const ORIGINAL = process.env.INTENT_SCORE_THRESHOLD;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INTENT_SCORE_THRESHOLD;
    else process.env.INTENT_SCORE_THRESHOLD = ORIGINAL;
  });

  test('a lowered threshold makes a moderate-intent query high-intent', () => {
    process.env.INTENT_SCORE_THRESHOLD = '10';
    const r = classifyQuery('Can we book a call?'); // score 17
    assert.equal(r.isHighIntent, true);
  });

  test('a raised threshold makes a normally-high-intent query no longer high-intent', () => {
    process.env.INTENT_SCORE_THRESHOLD = '95';
    const r = classifyQuery('We want a demo, then a trial, then to discuss the contract and timeline');
    assert.equal(r.isHighIntent, false);
  });
});
