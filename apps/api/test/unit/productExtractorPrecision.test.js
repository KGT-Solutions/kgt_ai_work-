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

  test('a policy page that links into a collection is still not a product', () => {
    // Storefront policy pages routinely link "browse everything" into a
    // collection. A category destination is not a purchase link for the
    // heading above it — PURCHASE_HREF_RE matches item paths only.
    const md = [
      '## Shipping Policy',
      '',
      'Free over ₹999. Browse [everything](https://acme.example/collections/all).'
    ].join('\n');
    assert.deepEqual(names(md), []);
  });

  test('a policy heading is not rescued by an item link sitting next to it', () => {
    // The administrative-heading guard is independent of what links or images
    // happen to be nearby, so this class cannot come back through another door.
    const md = [
      '## Returns Policy',
      '',
      'See [items](https://acme.example/products/all). A fee of $15 applies.'
    ].join('\n');
    assert.deepEqual(names(md), []);
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

  test('a /products/ link is a purchase signal even when the link text is not', () => {
    // BUY_HINT_RE's \bproduct\b does not match "products", so matching link
    // TEXT alone missed the commonest product URL shape there is. The href
    // path is matched separately for exactly this reason.
    const md = '## Whey Protein\n\n₹1999 [details](https://acme.example/products/whey)';
    assert.deepEqual(names(md), ['Whey Protein']);
  });

  test('a short canonical item path (/p/12345) is a purchase signal', () => {
    const md = '## Whey Protein\n\n₹1999 [Whey Protein 1kg](https://acme.example/p/12345)';
    assert.deepEqual(names(md), ['Whey Protein']);
  });

  test('an explicit SKU stands in for a link on a brochure with no URLs', () => {
    // A PDF brochure parsed to Markdown carries no hrefs and no image URLs, so
    // without this an uploaded catalogue would extract nothing from its
    // heading blocks — the upload path the feature exists to serve.
    const md = '## Whey Protein 1kg\n\nSKU WP-1K. ₹1999 per tub.';
    const out = extractProductsHeuristic(md);
    assert.deepEqual(out.map((p) => p.name), ['Whey Protein 1kg']);
    assert.equal(out[0].price, '₹1999');
  });

  test('a model number on a spec sheet is also an item code', () => {
    const md = '## Treadmill TX9\n\nModel no. TX-9000. ₹89999.';
    assert.deepEqual(names(md), ['Treadmill TX9']);
  });

  test('heading + price with no image, link or item code is left to the LLM tier', () => {
    // The deliberate remaining trade-off, pinned so it is a decision rather
    // than a surprise: bare prose with an amount is genuinely ambiguous (a fee,
    // a threshold, a past price), so the heuristic declines it and
    // SCRAPE_DISTILLATION_PRODUCTS is the opt-in path for messy prose.
    const md = '## Whey Protein 1kg\n\nTwenty four grams of protein per serving. ₹1999.';
    assert.deepEqual(names(md), []);
  });

  test('a generic section title is never itself the product name', () => {
    const md = ['## Our Products', '', '- Whey Protein 1kg — ₹1999', '- Creatine 250g — ₹899'].join('\n');
    assert.deepEqual(names(md), ['Whey Protein 1kg', 'Creatine 250g']);
  });
});
