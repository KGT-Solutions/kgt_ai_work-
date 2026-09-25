const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { pickFollowUp, DEFAULT_FOLLOW_UP } = require('../src/services/salesbot/followUps');

describe('pickFollowUp — deterministic CTA priority order', () => {
  test('a buying signal always wins, even alongside an objection and a known clientType', () => {
    const cta = pickFollowUp({
      clientType: 'builder',
      objectionTags: ['objection:pricing'],
      buyingSignals: ['demo']
    });
    assert.equal(cta, 'Would you like to schedule a short call or live demo with our team?');
  });

  test('with no buying signal, a known objection tag picks its matching CTA', () => {
    const cta = pickFollowUp({
      clientType: 'rwa_president',
      objectionTags: ['objection:payment_gateway_lag'],
      buyingSignals: []
    });
    assert.match(cta, /reconciles to a flat's ledger in real time/);
  });

  test('the first objection tag wins when several are present', () => {
    const cta = pickFollowUp({
      clientType: 'rwa_president',
      objectionTags: ['objection:pricing', 'objection:adoption_friction'],
      buyingSignals: []
    });
    assert.match(cta, /gateway-commission savings/); // the pricing CTA, not adoption_friction's
  });

  test('an objection tag with no mapped CTA falls through to the clientType CTA', () => {
    const cta = pickFollowUp({
      clientType: 'committee_member',
      objectionTags: ['objection:unmapped_tag'],
      buyingSignals: []
    });
    assert.match(cta, /comparison sheet you can share with your managing committee/);
  });

  test('with no signals and no objections, falls back to the clientType CTA', () => {
    assert.match(
      pickFollowUp({ clientType: 'builder', objectionTags: [], buyingSignals: [] }),
      /tower\/phase structure/
    );
    assert.match(
      pickFollowUp({ clientType: 'rwa_president', objectionTags: [], buyingSignals: [] }),
      /cost comparison against what your society spends today/
    );
  });

  test('an unrecognized/missing clientType falls back to the generic default CTA', () => {
    assert.equal(
      pickFollowUp({ clientType: 'unknown_type', objectionTags: [], buyingSignals: [] }),
      DEFAULT_FOLLOW_UP
    );
    assert.equal(
      pickFollowUp({ clientType: undefined, objectionTags: [], buyingSignals: [] }),
      DEFAULT_FOLLOW_UP
    );
  });
});
