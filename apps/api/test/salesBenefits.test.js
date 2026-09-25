const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractKeyBenefits, BENEFIT_LABELS } = require('../src/services/salesbot/benefits');

function chunkWithTags(tags) {
  return { chunk: { tags } };
}

describe('extractKeyBenefits — deterministic, chunk-grounded badge extraction', () => {
  test('extracts a known benefit label from a single tagged chunk', () => {
    const labels = extractKeyBenefits([chunkWithTags(['benefit:zero_gateway_commission'])]);
    assert.deepEqual(labels, [BENEFIT_LABELS['benefit:zero_gateway_commission']]);
  });

  test('ignores non-benefit tags entirely (e.g. client: or objection: tags)', () => {
    const labels = extractKeyBenefits([chunkWithTags(['client:builder', 'objection:pricing'])]);
    assert.deepEqual(labels, []);
  });

  test('ignores a benefit: tag with no known label (unrecognized/typo tag)', () => {
    const labels = extractKeyBenefits([chunkWithTags(['benefit:does_not_exist'])]);
    assert.deepEqual(labels, []);
  });

  test('collects benefits across multiple chunks in ranked order', () => {
    const ranked = [
      chunkWithTags(['benefit:transparent_ledger']),
      chunkWithTags(['benefit:zero_gateway_commission'])
    ];
    const labels = extractKeyBenefits(ranked);
    assert.deepEqual(labels, [
      BENEFIT_LABELS['benefit:transparent_ledger'],
      BENEFIT_LABELS['benefit:zero_gateway_commission']
    ]);
  });

  test('never lists the same benefit twice, even if two chunks share a tag', () => {
    const ranked = [
      chunkWithTags(['benefit:zero_gateway_commission']),
      chunkWithTags(['benefit:zero_gateway_commission', 'benefit:transparent_ledger'])
    ];
    const labels = extractKeyBenefits(ranked);
    assert.equal(labels.filter((l) => l === BENEFIT_LABELS['benefit:zero_gateway_commission']).length, 1);
    assert.equal(labels.length, 2);
  });

  test('caps the result at 4 benefits by default, in encounter order', () => {
    const ranked = [
      chunkWithTags([
        'benefit:proof_based_collections',
        'benefit:zero_gateway_commission',
        'benefit:flexible_expense_splitting',
        'benefit:instant_pwa_install',
        'benefit:transparent_ledger'
      ])
    ];
    const labels = extractKeyBenefits(ranked);
    assert.equal(labels.length, 4);
    assert.deepEqual(labels, [
      BENEFIT_LABELS['benefit:proof_based_collections'],
      BENEFIT_LABELS['benefit:zero_gateway_commission'],
      BENEFIT_LABELS['benefit:flexible_expense_splitting'],
      BENEFIT_LABELS['benefit:instant_pwa_install']
    ]);
  });

  test('a custom cap is respected', () => {
    const ranked = [
      chunkWithTags(['benefit:proof_based_collections', 'benefit:zero_gateway_commission', 'benefit:transparent_ledger'])
    ];
    assert.equal(extractKeyBenefits(ranked, 1).length, 1);
    assert.equal(extractKeyBenefits(ranked, 2).length, 2);
  });

  test('returns an empty array for an empty rankedChunks input (the action-handler-bypass shape)', () => {
    assert.deepEqual(extractKeyBenefits([]), []);
  });

  test('does not throw when a chunk has no tags array at all', () => {
    assert.deepEqual(extractKeyBenefits([{ chunk: {} }]), []);
  });
});
