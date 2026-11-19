const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const router = require('../../src/routes/publicRegister.routes');

// Pure crawl-only signups default to the Sales Bot (publicRegister.inferBotPreference)
// so a product catalog launches on its strong Sales score rather than the Support
// Bot's empty one — unless the caller explicitly chose a preference.
const { inferBotPreference } = router;

const crawled = (n = 2) => Array.from({ length: n }, (_, i) => ({ sourceUrl: `https://x.example/p${i}` }));
const uploaded = (n = 1) => Array.from({ length: n }, () => ({ sourceUrl: null }));

describe('publicRegister.inferBotPreference', () => {
  test('pure crawl + no explicit choice → sales', () => {
    assert.equal(inferBotPreference(undefined, 'both', crawled()), 'sales');
    assert.equal(inferBotPreference('', 'both', crawled()), 'sales');
  });

  test('an explicit choice is always respected, even on a pure crawl', () => {
    assert.equal(inferBotPreference('both', 'both', crawled()), 'both');
    assert.equal(inferBotPreference('support', 'support', crawled()), 'support');
    assert.equal(inferBotPreference('sales', 'sales', crawled()), 'sales');
  });

  test('a mixed or upload-containing set keeps the parsed default (both)', () => {
    assert.equal(inferBotPreference(undefined, 'both', [...crawled(), ...uploaded()]), 'both');
    assert.equal(inferBotPreference(undefined, 'both', uploaded(2)), 'both');
  });

  test('no pages → parsed default (never infers from an empty set)', () => {
    assert.equal(inferBotPreference(undefined, 'both', []), 'both');
  });
});
