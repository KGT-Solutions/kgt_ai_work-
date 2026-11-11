// Which part of the page extractPage() actually keeps.
//
// The "comprehensive extraction" work (d51e581) replaced the old
// MAIN_CONTENT_SELECTORS list with PREFERRED_CONTAINERS = ['main', 'article']
// and, in the same change, swapped `$(selector)` for `$(selector).first()`.
// The stated goal was that "product grids are never skipped" — these tests pin
// that promise against the markup it most often appears in.
//
// The existing coverage in crawler.test.js exercises a page built from
// <section>/<div>, where the body fallback does the right thing. The cases
// below are the ones `.first()` changes: a page whose repeated content blocks
// ARE the semantic containers.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractPage } = require('../../src/services/shared/crawler');

const DESC = (i) =>
  `This is the full product description for item number ${i}. It is made of durable ` +
  'material, ships within two business days, and carries a one year manufacturer warranty.';

// A Shopify/WooCommerce-style collections page: one <article> per product card,
// no <main> wrapper. Extremely common — it is the default card markup in several
// major themes.
function articleGrid(count) {
  const cards = [];
  for (let i = 1; i <= count; i++) {
    cards.push(
      '<article class="product-card">',
      `<h2>Product ${i} Deluxe Edition</h2>`,
      `<p>${DESC(i)}</p>`,
      `<span class="price">Rs. ${i}99</span>`,
      '</article>'
    );
  }
  return ['<html><body>', ...cards, '</body></html>'].join('\n');
}

const namesIn = (markdown, count) => {
  const found = [];
  for (let i = 1; i <= count; i++) if (markdown.includes(`Product ${i} Deluxe Edition`)) found.push(i);
  return found;
};

describe('crawler: extraction scope over repeated semantic containers', () => {
  test('a product grid of <article> cards keeps EVERY card, not just the first', () => {
    const page = extractPage(articleGrid(8), new URL('https://shop.example/collections/all'));

    // The whole point of the deep-scrape work: a collections page must carry
    // its entire grid into the knowledge base, because each card is the only
    // place that product's name, price and description appear.
    //
    // FAILING AGAINST crawler.js AS WRITTEN: PREFERRED_CONTAINERS is walked
    // with `$(selector).first()`, so the first <article> becomes the whole
    // document and cards 2..8 are dropped. Fix: match every occurrence (as
    // MAIN_CONTENT_SELECTORS did before d51e581), or only prefer a container
    // when the page has exactly one of them.
    assert.deepEqual(
      namesIn(page.markdown, 8),
      [1, 2, 3, 4, 5, 6, 7, 8],
      'every <article> product card should survive extraction'
    );
  });

  test('that grid keeps its prices too — a card without its price is not a usable product', () => {
    const page = extractPage(articleGrid(5), new URL('https://shop.example/collections/all'));
    for (const i of [1, 2, 3, 4, 5]) {
      assert.match(page.markdown, new RegExp(`Rs\\. ${i}99`), `price for product ${i} should be captured`);
    }
  });

  test('a blog index of <article> posts keeps every entry', () => {
    const posts = [];
    for (let i = 1; i <= 4; i++) {
      posts.push('<article>', `<h2>Guide ${i}: choosing a supplement</h2>`, `<p>${DESC(i)}</p>`, '</article>');
    }
    const page = extractPage(['<html><body>', ...posts, '</body></html>'].join('\n'), new URL('https://shop.example/blogs/news'));
    for (const i of [1, 2, 3, 4]) {
      assert.match(page.markdown, new RegExp(`Guide ${i}:`), `blog entry ${i} should be captured`);
    }
  });

  test('a single <main> is still used as the tighter scope (the behaviour .first() was aiming for)', () => {
    // This is the case PREFERRED_CONTAINERS exists to serve, and it must keep
    // working after the fix above: one semantic landmark, so global promo rails
    // outside it are correctly excluded.
    const page = extractPage(
      [
        '<html><body>',
        '<section class="promo"><h2>Sitewide Sale</h2><p>Twenty percent off everything this weekend.</p></section>',
        `<main><h1>Whey Protein 1kg</h1><p>${DESC(1)}</p><span>Rs. 1999</span></main>`,
        '</body></html>'
      ].join('\n'),
      new URL('https://shop.example/products/whey')
    );
    assert.match(page.markdown, /## Whey Protein 1kg/);
    assert.match(page.markdown, /Rs\. 1999/);
    assert.doesNotMatch(page.markdown, /Sitewide Sale/, 'content outside a real <main> is out of scope');
  });

  test('an empty JS-shell <main> still falls through to the server-rendered body', () => {
    // Regression guard for the documented reason the content floor exists.
    const page = extractPage(
      [
        '<html><body>',
        '<main id="app"></main>',
        `<div class="content"><h1>Creatine 250g</h1><p>${DESC(2)}</p></div>`,
        '</body></html>'
      ].join('\n'),
      new URL('https://shop.example/products/creatine')
    );
    assert.match(page.markdown, /## Creatine 250g/);
  });
});
