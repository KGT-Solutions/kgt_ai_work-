// What the heuristic extractor must NOT turn into a product.
//
// productExtractor.js runs on every scrape, file upload and pasted note because
// AUTO_PRODUCT_EXTRACTION defaults on, and anything it emits becomes a
// ProductCatalog row that productMatch.js renders as a card — thumbnail, price
// and a purchase link — underneath a chat reply. So a false positive is not
// cosmetic: it invents a buyable item, with a price, for a company that may
// sell nothing of the kind.
//
// The module's own contract (header comment) is:
//
//   "It is precision-first on purpose: it emits a product only on a real signal
//    (a table row, or a price / image / buy-link near a name), so a blog page or
//    policy doc does not pollute the catalog with junk cards."
//
// The existing negative test covers a policy heading with no price at all. The
// cases below are the ones that decide whether that sentence is true, because
// prices appear constantly in text that describes no product: fee schedules,
// refund thresholds, shipping rules, pricing commentary.
//
// FAILING AGAINST productExtractor.js AS WRITTEN: extractHeadingBlocks() treats
// `PRICE_RE.test(scope)` as sufficient signal, so ANY "## Heading" whose lead
// line contains a currency amount becomes a product named after the heading.
// Suggested fix: require a stronger signal for the heading pass — an image or a
// buy/product link, or a price plus a product-ish cue — and leave bare
// "heading + an amount" to the table and bullet passes, which are precise.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractProductsHeuristic } = require('../../src/services/product-extractor/productExtractor');

const names = (md) => extractProductsHeuristic(md).map((p) => p.name);

describe('productExtractor: precision on non-catalog content', () => {
  test('a services fee schedule is not a product catalog', () => {
    // A law firm, clinic, agency or consultancy — the platform explicitly
    // serves these (BUSINESS_CATEGORIES includes "services").
    const md = [
      '## Consultation Fees',
      '',
      'Our initial consultation is $150 and covers a full case review.',
      '',
      '## Retainer',
      '',
      'A standard retainer is $2,500, billed monthly.'
    ].join('\n');
    assert.deepEqual(names(md), [], 'fee headings are not purchasable products');
  });

  test('a refund / returns policy is not a product catalog', () => {
    const md = [
      '## Refund Threshold',
      '',
      'Orders above $50 qualify for free return shipping.',
      '',
      '## Restocking Fee',
      '',
      'A restocking fee of $15 applies to opened items.'
    ].join('\n');
    assert.deepEqual(names(md), [], 'policy clauses that quote an amount are not products');
  });

  test('a blog post that mentions a past price is not a product', () => {
    const md = [
      '## Why we raised our prices in 2026',
      '',
      'Last year a subscription cost $99. Here is the reasoning behind the change.'
    ].join('\n');
    assert.deepEqual(names(md), [], 'editorial content is never a catalog row');
  });

  test('a shipping policy quoting thresholds is not a product', () => {
    const md = [
      '## Shipping',
      '',
      'Delivery is free on orders over ₹999. Below that a flat ₹49 applies.'
    ].join('\n');
    assert.deepEqual(names(md), [], 'shipping rules are not products');
  });
});

describe('productExtractor: the signals that SHOULD extract (precision kept, not lost)', () => {
  // These must stay green after the heading-pass fix above — the point is to
  // tighten the heading heuristic without weakening the real ones.

  test('a Markdown table of products extracts every row', () => {
    const md = [
      '| Product | Price | SKU |',
      '| --- | --- | --- |',
      '| Whey Protein 1kg | Rs. 1,999 | WP-1K |',
      '| Creatine 250g | Rs. 899 | CR-250 |'
    ].join('\n');
    const out = extractProductsHeuristic(md);
    assert.deepEqual(out.map((p) => p.name), ['Whey Protein 1kg', 'Creatine 250g']);
    assert.deepEqual(out.map((p) => p.sku), ['WP-1K', 'CR-250']);
    assert.equal(out[0].price, 'Rs. 1,999');
  });

  test('price-bearing bullets extract as products', () => {
    const md = ['- Whey Protein 1kg — ₹1999 chocolate flavour', '- Creatine 250g — ₹899'].join('\n');
    const out = extractProductsHeuristic(md);
    assert.deepEqual(out.map((p) => p.name), ['Whey Protein 1kg', 'Creatine 250g']);
    assert.equal(out[0].price, '₹1999');
  });

  test('a heading block with a real buy link is a product', () => {
    const md = [
      '## Whey Protein 1kg',
      '',
      '![tub](https://cdn.example/whey.png)',
      '',
      'Twenty four grams of protein per serving. ₹1999.',
      '',
      '[Buy now](https://shop.example/products/whey)'
    ].join('\n');
    const out = extractProductsHeuristic(md);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Whey Protein 1kg');
    assert.equal(out[0].productUrl, 'https://shop.example/products/whey');
    assert.equal(out[0].imageUrl, 'https://cdn.example/whey.png');
  });

  test('a heading block with a product image and a price is a product', () => {
    const md = [
      '## Creatine Monohydrate 250g',
      '',
      '![jar](https://cdn.example/creatine.jpg) ₹899',
      '',
      'Micronised, unflavoured, five grams per scoop.'
    ].join('\n');
    const out = extractProductsHeuristic(md);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Creatine Monohydrate 250g');
  });

  test('a generic section title is never itself the product name', () => {
    const md = ['## Our Products', '', '- Whey Protein 1kg — ₹1999', '- Creatine 250g — ₹899'].join('\n');
    assert.deepEqual(names(md), ['Whey Protein 1kg', 'Creatine 250g']);
  });
});
