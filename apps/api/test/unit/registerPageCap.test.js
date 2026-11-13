const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// normalizePages is attached to the router for testing (see the route file).
const router = require('../../src/routes/publicRegister.routes');
const { normalizePages, MAX_PAGES_ON_COMPLETE: CAP } = router;

const page = (title, sourceUrl) => ({ title, content: 'Some real content for this page.', sourceUrl });

describe('publicRegister: normalizePages intelligent cap', () => {
  test('keeps everything (in order) when under the cap', () => {
    const r = normalizePages([page('A', 'https://shop.example/a'), page('B'), page('C')]);
    assert.equal(r.ok, true);
    assert.equal(r.discovered, 3);
    assert.deepEqual(r.pages.map((p) => p.title), ['A', 'B', 'C']);
  });

  test('drops pages without both a title and content', () => {
    const r = normalizePages([page('A', 'https://x.example/a'), { title: '', content: 'x' }, { title: 'B', content: '' }]);
    assert.equal(r.discovered, 1);
    assert.equal(r.pages.length, 1);
  });

  test('over the cap: retains high-value focus pages over low-priority index pages, regardless of position', () => {
    // CAP+50 pages. The LAST 10 are focus-directory product pages (/products/),
    // the rest are low-priority "junk" index pages in index order. The focus
    // pages must survive despite being last, and the surplus junk is dropped
    // from the tail — proving priority beats submission position.
    const total = CAP + 50;
    const focusStart = total - 10; // last 10 are focus
    const input = [];
    for (let i = 0; i < total; i++) {
      input.push(i >= focusStart
        ? page(`FOCUS ${i}`, `https://shop.example/products/p${i}`)
        : page(`JUNK ${i}`, `https://shop.example/misc/${i}`));
    }

    const r = normalizePages(input);
    assert.equal(r.discovered, total);
    assert.equal(r.pages.length, CAP);

    // All 10 focus pages kept.
    assert.equal(r.pages.filter((p) => p.title.startsWith('FOCUS')).length, 10);
    // Earliest junk kept, latest junk dropped.
    const titles = new Set(r.pages.map((p) => p.title));
    assert.ok(titles.has('JUNK 0'), 'earliest junk page should be kept');
    assert.ok(!titles.has(`JUNK ${focusStart - 1}`), 'the last junk page should have been dropped for the cap');
    // Kept set is restored to original order: junk (low indices) first, focus last.
    assert.equal(r.pages[0].title, 'JUNK 0');
    assert.equal(r.pages[r.pages.length - 1].title, `FOCUS ${total - 1}`);
  });

  test('a content-keyword title/url outranks a plain page when truncating', () => {
    const total = CAP + 5;
    const input = [];
    // First CAP are plain pages; the last 5 read like real content ("pricing").
    for (let i = 0; i < CAP; i++) input.push(page(`Plain ${i}`, `https://x.example/n/${i}`));
    for (let i = 0; i < 5; i++) input.push(page(`Pricing and plans ${i}`, `https://x.example/info/${i}`));
    const r = normalizePages(input);
    assert.equal(r.pages.length, CAP);
    // The 5 keyword pages (priority 1) displace 5 of the trailing plain pages (priority 0).
    assert.equal(r.pages.filter((p) => p.title.startsWith('Pricing')).length, 5);
  });
});
