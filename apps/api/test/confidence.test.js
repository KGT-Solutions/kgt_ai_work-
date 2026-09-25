const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeConfidence } = require('../src/engine/confidence');

describe('confidence: saturating curve score/(score+k)', () => {
  test('zero or negative raw score yields zero confidence (never negative)', () => {
    assert.equal(computeConfidence('bill payment', 0), 0);
    assert.equal(computeConfidence('bill payment', -5), 0);
  });

  test('an empty/all-stopword query yields zero confidence regardless of score', () => {
    assert.equal(computeConfidence('', 10), 0);
    assert.equal(computeConfidence('the a an', 10), 0);
  });

  test('confidence is strictly bounded to [0, 1] across a wide score range', () => {
    for (const score of [0.1, 1, 3, 6, 10, 100, 100000]) {
      const c = computeConfidence('maintenance bill payment', score);
      assert.ok(c >= 0 && c <= 1, `confidence ${c} out of bounds for score ${score}`);
    }
  });

  test('confidence is monotonically non-decreasing as raw score increases', () => {
    const scores = [0, 0.5, 1, 2, 3, 5, 8, 13, 21, 50];
    let prev = -Infinity;
    for (const s of scores) {
      const c = computeConfidence('maintenance bill payment', s);
      assert.ok(c >= prev, `confidence decreased at score ${s}: ${prev} -> ${c}`);
      prev = c;
    }
  });

  test('at the default k (titleWeight 3 + bodyCapPerTerm 3 + 2*exactBonus 2 = 10), a score equal to k lands at exactly 0.5', () => {
    // k must track lexicalSearch.scoreItem's real per-term ceiling: a single
    // term that exact-matches BOTH title and body can score up to
    // (titleWeight+exactBonus) + (bodyCapPerTerm+exactBonus) = 5 + 5 = 10.
    // Regression guard: k previously went stale at 6 (pre-exact-match-bonus)
    // after lexicalSearch.js added the exact-match bonus, silently inflating
    // confidence for exact/tag-boosted matches past what the gate intended.
    assert.equal(computeConfidence('maintenance bill', 10), 0.5);
  });

  test('a custom saturationK overrides the titleWeight/bodyCapPerTerm/exactBonus-derived default', () => {
    const withDefault = computeConfidence('maintenance bill', 10);
    const withCustomK = computeConfidence('maintenance bill', 10, { saturationK: 2 });
    assert.equal(withCustomK, 10 / 12);
    assert.notEqual(withDefault, withCustomK);
  });

  test('30% gate boundary at the default k=10: a raw score of 5 clears a 0.30 threshold, a raw score of 4 does not', () => {
    const passes = computeConfidence('maintenance bill', 5);
    const fails = computeConfidence('maintenance bill', 4);
    assert.ok(passes >= 0.3, `expected score=5 to clear 0.30 gate, got ${passes}`);
    assert.ok(fails < 0.3, `expected score=4 to fail 0.30 gate, got ${fails}`);
  });

  test('a single strong hit (score == k) already lands near the middle of the scale, not penalized by query length', () => {
    // Regression guard for the abandoned first formula (topScore / (termCount *
    // maxPerTerm)), which unfairly divided by every filler word in a long
    // query even though stopwords are stripped before scoring ever runs.
    const shortQuery = computeConfidence('bill', 10);
    const longQuery = computeConfidence('how many days do I have to pay this outstanding bill', 10);
    assert.equal(shortQuery, 0.5);
    assert.equal(longQuery, 0.5, 'query length must not change confidence for the same raw score');
  });
});
