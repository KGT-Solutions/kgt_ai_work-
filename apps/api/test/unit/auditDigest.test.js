const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildDigest } = require('../../src/services/tenantFaqs');

// The scaled, full-coverage audit digest (buildDigest coverAll). Depth-first
// (FAQ generation) is unchanged; coverAll (the auditor) samples every document so
// a large crawl isn't judged on only its first ~30 pages.

const docs = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Doc ${i}`, category: 'CORE_OVERVIEW',
  content: `This is the body of document number ${i}. `.repeat(40)
}));
const countDocs = (digest) => (digest.match(/### Doc \d+ \(/g) || []).length;

describe('buildDigest: coverAll audit mode', () => {
  test('depth-first default drops later docs once the budget fills', () => {
    const digest = buildDigest(docs(150)); // default 12k budget, 600+ chars/doc
    assert.ok(countDocs(digest) < 150, 'the default digest cannot fit all 150 docs');
  });

  test('coverAll includes every document at a representative snippet', () => {
    const digest = buildDigest(docs(150), 60000, { coverAll: true });
    assert.equal(countDocs(digest), 150, 'every one of the 150 docs contributes');
    assert.ok(digest.length <= 60000, 'stays within the budget ceiling');
  });

  test('coverAll includes strictly more documents than the depth-first default', () => {
    const set = docs(150);
    assert.ok(countDocs(buildDigest(set, 60000, { coverAll: true })) > countDocs(buildDigest(set)));
  });

  test('small document sets are unaffected (full snippets, all included)', () => {
    const digest = buildDigest(docs(3), 20000, { coverAll: true });
    assert.equal(countDocs(digest), 3);
  });
});
