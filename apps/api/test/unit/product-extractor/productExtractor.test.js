const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractProductsHeuristic, extractProducts, mergeProducts, slugifySku, isAutoProductExtractionEnabled
} = require('../../src/services/shared/productExtractor');

describe('productExtractor: heuristic — Markdown tables', () => {
  test('maps columns by header and captures every row, ignoring $ / ₹ currencies', () => {
    const md = [
      '| Product Name | Price | Description | Image | Buy Link |',
      '| --- | --- | --- | --- | --- |',
      '| Whey Protein | ₹1,999 | 1kg chocolate | https://img/w.png | https://shop/w |',
      '| Shaker | $5 | 700ml | | https://shop/s |'
    ].join('\n');
    const p = extractProductsHeuristic(md);
    assert.equal(p.length, 2);
    assert.deepEqual(p[0], {
      name: 'Whey Protein', sku: '', price: '₹1,999', description: '1kg chocolate',
      imageUrl: 'https://img/w.png', productUrl: 'https://shop/w'
    });
    assert.equal(p[1].name, 'Shaker');
    assert.equal(p[1].price, '$5');
    assert.equal(p[1].imageUrl, ''); // empty cell → safe fallback, layout not broken
    assert.equal(p[1].productUrl, 'https://shop/s');
  });

  test('a table row keeps name + description even with no price or image (no data lost)', () => {
    const md = '| Item | Notes |\n| - | - |\n| Resistance Band | Latex, medium tension |';
    const [p] = extractProductsHeuristic(md);
    assert.equal(p.name, 'Resistance Band');
    assert.equal(p.price, '');
    assert.equal(p.imageUrl, '');
  });

  test('uses an explicit SKU column when present', () => {
    const md = '| Name | SKU | Price |\n| - | - | - |\n| Creatine | CRE-01 | ₹899 |';
    assert.equal(extractProductsHeuristic(md)[0].sku, 'CRE-01');
  });
});

describe('productExtractor: heuristic — lists and headings', () => {
  test('bullet items with a price: name before the price, rest as description', () => {
    const md = '- Multivitamin — ₹499 daily essentials\n* Fish Oil: $12 omega-3\n- just a note with no price';
    const p = extractProductsHeuristic(md);
    assert.deepEqual(p.map((x) => x.name), ['Multivitamin', 'Fish Oil']);
    assert.equal(p[0].price, '₹499');
    assert.equal(p[0].description, 'daily essentials');
  });

  test('heading block with a price and a buy link becomes one product', () => {
    const md = '## Mass Gainer\nHigh-calorie blend for ₹2499. [Buy now](https://shop/mg) ![pic](https://img/mg.jpg)';
    const [p] = extractProductsHeuristic(md);
    assert.equal(p.name, 'Mass Gainer');
    assert.equal(p.price, '₹2499');
    assert.equal(p.productUrl, 'https://shop/mg');
    assert.equal(p.imageUrl, 'https://img/mg.jpg');
    assert.match(p.description, /High-calorie blend/);
  });

  test('a generic section heading above a list is NOT itself a product', () => {
    const md = '## Products\n- Whey — ₹1999\n- Creatine — ₹899';
    const p = extractProductsHeuristic(md);
    assert.deepEqual(p.map((x) => x.name), ['Whey', 'Creatine']); // no "Products" row
  });

  test('a prose heading with no product signal is ignored (precision-first)', () => {
    assert.deepEqual(extractProductsHeuristic('## Return Policy\nReturns accepted within 30 days.'), []);
  });
});

describe('productExtractor: mergeProducts + slugify', () => {
  test('merges lists, de-duplicates by sku then name, first wins', () => {
    const a = [{ name: 'Whey', sku: 'w-1', price: '₹1999' }];
    const b = [{ name: 'Whey', sku: 'w-1', price: '₹2999' }, { name: 'Creatine' }];
    const merged = mergeProducts(a, b);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].price, '₹1999'); // first occurrence wins
    assert.deepEqual(merged.map((p) => p.name), ['Whey', 'Creatine']);
  });

  test('slugifySku makes a safe slug and falls back to "item"', () => {
    assert.equal(slugifySku('Whey Protein 1kg!'), 'whey-protein-1kg');
    assert.equal(slugifySku('   '), 'item');
  });
});

describe('productExtractor: extractProducts (heuristic + optional LLM)', () => {
  test('heuristic only by default (no LLM call)', async () => {
    const out = await extractProducts('| Name | Price |\n| - | - |\n| Pen | $2 |');
    assert.deepEqual(out.map((p) => p.name), ['Pen']);
  });

  test('useLlm merges the distillation pass, heuristic winning on collisions', async () => {
    const distill = async () => ({ products: [{ name: 'Pen', sku: '', price: 'WRONG' }, { name: 'LLM Find', sku: 'llm-1' }] });
    const out = await extractProducts('- Pen — $2 ballpoint', { useLlm: true, distill });
    assert.deepEqual(out.map((p) => p.name), ['Pen', 'LLM Find']);
    assert.equal(out[0].price, '$2'); // verbatim heuristic value kept over the LLM's
  });

  test('a throwing LLM pass degrades to the heuristic result, never throws', async () => {
    const distill = async () => { throw new Error('llm down'); };
    const out = await extractProducts('- Pen — $2', { useLlm: true, distill });
    assert.deepEqual(out.map((p) => p.name), ['Pen']);
  });
});

describe('productExtractor: isAutoProductExtractionEnabled', () => {
  test('defaults on; respects an explicit off switch', () => {
    const prev = process.env.AUTO_PRODUCT_EXTRACTION;
    delete process.env.AUTO_PRODUCT_EXTRACTION;
    assert.equal(isAutoProductExtractionEnabled(), true);
    process.env.AUTO_PRODUCT_EXTRACTION = 'false';
    assert.equal(isAutoProductExtractionEnabled(), false);
    process.env.AUTO_PRODUCT_EXTRACTION = 'on';
    assert.equal(isAutoProductExtractionEnabled(), true);
    if (prev === undefined) delete process.env.AUTO_PRODUCT_EXTRACTION; else process.env.AUTO_PRODUCT_EXTRACTION = prev;
  });
});
