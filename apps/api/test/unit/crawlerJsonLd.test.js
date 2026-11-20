const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { extractPage } = require('../../src/services/shared/crawler');

// JSON-LD structured-data extraction (crawler.extractPage). The crawler strips
// <script>, so these facts would be lost without the dedicated parse pass.

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const page = (head, body) => extractPage(`<html><head><title>T</title>${head}</head><body>${body}</body></html>`, new URL('https://x.example/p'));

describe('crawler: JSON-LD structured data', () => {
  test('Product price/name and FAQ Q&A are folded into the markdown (HTML stripped from answers)', () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'Product', name: 'Super Widget',
      brand: { '@type': 'Brand', name: 'Acme' }, sku: 'SW-1',
      offers: { '@type': 'Offer', price: '299.00', priceCurrency: 'INR' }, description: 'A great widget' })
      + ld({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'Do you ship overseas?',
          acceptedAnswer: { '@type': 'Answer', text: '<p>Yes, <strong>worldwide</strong>.</p>' } }] });
    const { markdown } = page(head, '<main><h1>Super Widget</h1><p>Buy it now.</p></main>');

    assert.match(markdown, /## Products/);
    assert.match(markdown, /Super Widget/);
    assert.match(markdown, /INR 299\.00/);
    assert.match(markdown, /SKU SW-1/);
    assert.match(markdown, /## Frequently asked questions/);
    assert.match(markdown, /Do you ship overseas\?/);
    assert.match(markdown, /Yes,\s+worldwide/); // inner <strong> stripped to a space (avoids word-joining)
    assert.ok(!/<p>|<strong>/.test(markdown), 'HTML tags inside the answer are stripped');
  });

  test('@graph, arrays, LocalBusiness hours, and SoftwareApplication are handled', () => {
    const head = ld({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'LocalBusiness', name: 'Clinic A', telephone: '+91-11-1234', openingHoursSpecification: [
        { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday'], opens: '09:00', closes: '17:00' }] },
      { '@type': 'SoftwareApplication', name: 'KGT App', applicationCategory: 'BusinessApplication',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } }
    ] });
    const { markdown } = page(head, '<main><h1>Home</h1><p>Welcome to the clinic.</p></main>');
    assert.match(markdown, /## Company details/);
    assert.match(markdown, /Phone: \+91-11-1234/);
    assert.match(markdown, /Hours:.*09:00-17:00/);
    assert.match(markdown, /## Product and plan details/);
    assert.match(markdown, /KGT App/);
  });

  test('malformed JSON-LD never throws, and a page with none is unchanged', () => {
    assert.doesNotThrow(() => page('<script type="application/ld+json">{ not: valid json }</script>', '<main><h1>H</h1><p>body text here</p></main>'));
    const plain = page('', '<main><h1>Plain</h1><p>Just prose, no structured data at all here.</p></main>');
    assert.ok(!/## Products|## Frequently asked questions|## Company details/.test(plain.markdown));
    assert.match(plain.markdown, /Just prose/);
  });
});
