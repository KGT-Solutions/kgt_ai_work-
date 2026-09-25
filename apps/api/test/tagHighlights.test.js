const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractTaggedHighlights, labelFromSlug } = require('../src/services/shared/tagHighlights');

function chunkWithTags(tags) {
  return { chunk: { tags } };
}

describe('labelFromSlug — generic, no lookup table', () => {
  test('title-cases a snake_case slug', () => {
    assert.equal(labelFromSlug('zero_setup_fees'), 'Zero Setup Fees');
  });
  test('handles a single-word slug', () => {
    assert.equal(labelFromSlug('fast'), 'Fast');
  });
});

describe('extractTaggedHighlights — tag-based benefit badges for the Sales Bot', () => {
  test('extracts a label for any tag under the given prefix, with no hardcoded vocabulary', () => {
    const labels = extractTaggedHighlights([chunkWithTags(['benefit:same_day_shipping'])], 'benefit');
    assert.deepEqual(labels, ['Same Day Shipping']);
  });

  test('ignores tags under a different prefix', () => {
    const labels = extractTaggedHighlights([chunkWithTags(['objection:pricing', 'client:builder'])], 'benefit');
    assert.deepEqual(labels, []);
  });

  test('dedupes a tag repeated across chunks', () => {
    const ranked = [chunkWithTags(['benefit:x']), chunkWithTags(['benefit:x', 'benefit:y'])];
    const labels = extractTaggedHighlights(ranked, 'benefit');
    assert.deepEqual(labels, ['X', 'Y']);
  });

  test('respects the default and a custom cap', () => {
    const ranked = [chunkWithTags(['benefit:a', 'benefit:b', 'benefit:c', 'benefit:d', 'benefit:e'])];
    assert.equal(extractTaggedHighlights(ranked, 'benefit').length, 4); // default cap
    assert.equal(extractTaggedHighlights(ranked, 'benefit', 2).length, 2);
  });

  test('returns [] for untagged (e.g. freshly scraped, unedited) chunks — no false badges', () => {
    assert.deepEqual(extractTaggedHighlights([{ chunk: {} }, { chunk: { tags: [] } }], 'benefit'), []);
  });

  test('returns [] for an empty rankedChunks array (the action-handler-bypass shape)', () => {
    assert.deepEqual(extractTaggedHighlights([], 'benefit'), []);
  });
});
