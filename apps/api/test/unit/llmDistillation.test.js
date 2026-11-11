const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  distillMarkdown, distillPages, splitJsonBlocks, cleanProducts
} = require('../../src/services/llm-distillation/llmDistillation');

// A fake LLM `generate` is injected everywhere so these run with no provider
// configured and no network. RAW is comfortably above the min-words-to-distill
// floor so distillation actually engages.
const RAW = `## Home\n\n${'word '.repeat(60)}`;
const CLEAN = `## Product Specs\n\n${'clean '.repeat(50)}`;
const withProducts = (json) => ({ text: `${CLEAN}\n\n\`\`\`json\n${json}\n\`\`\`` });

describe('llmDistillation: distillMarkdown', () => {
  test('cleans the markdown, strips the json block, and returns parsed products', async () => {
    const generate = async () => withProducts('[{"name":"Widget","price":"$9","productUrl":"https://shop/w"}]');
    const r = await distillMarkdown(RAW, { generate });
    assert.equal(r.distilled, true);
    assert.match(r.markdown, /## Product Specs/);
    assert.doesNotMatch(r.markdown, /```json/);
    assert.equal(r.products.length, 1);
    assert.equal(r.products[0].name, 'Widget');
    assert.equal(r.products[0].productUrl, 'https://shop/w');
  });

  test('passes short input straight through without calling the LLM', async () => {
    let called = 0;
    const generate = async () => { called += 1; return { text: 'x' }; };
    const r = await distillMarkdown('just a tiny bit of text', { generate });
    assert.equal(called, 0);
    assert.equal(r.distilled, false);
    assert.equal(r.markdown, 'just a tiny bit of text');
  });

  test('keeps the raw text when the model summarized too much away', async () => {
    const generate = async () => ({ text: '## X\n\nshort' });
    const r = await distillMarkdown(RAW, { generate });
    assert.equal(r.distilled, false);
    assert.equal(r.markdown, RAW);
  });

  test('never throws — an LLM failure falls back to the raw text', async () => {
    const generate = async () => { throw new Error('LLM down'); };
    const r = await distillMarkdown(RAW, { generate });
    assert.equal(r.distilled, false);
    assert.equal(r.markdown, RAW);
    assert.deepEqual(r.products, []);
  });
});

describe('llmDistillation: parsing helpers', () => {
  test('splitJsonBlocks removes every fenced json block and parses the last array', () => {
    const { markdown, products } = splitJsonBlocks('text\n```json\n[{"name":"A"}]\n```\ntail');
    assert.match(markdown, /text/);
    assert.match(markdown, /tail/);
    assert.doesNotMatch(markdown, /```/);
    assert.equal(products[0].name, 'A');
  });

  test('cleanProducts drops nameless items and non-http URLs, keeps good ones', () => {
    const ps = cleanProducts([
      { name: 'A', imageUrl: 'javascript:alert(1)', productUrl: 'https://ok/a' },
      { sku: 'NO-NAME' },
      { name: 'B', price: '$5' }
    ]);
    assert.equal(ps.length, 2);
    assert.equal(ps[0].imageUrl, ''); // unsafe scheme dropped
    assert.equal(ps[0].productUrl, 'https://ok/a');
    assert.equal(ps[1].name, 'B');
  });
});

describe('llmDistillation: distillPages', () => {
  test('distills each page and de-duplicates products across pages (by sku)', async () => {
    const generate = async () => withProducts('[{"name":"Widget","sku":"W1"}]');
    const pages = [
      { title: 'a', markdown: RAW, url: 'u1' },
      { title: 'b', markdown: RAW, url: 'u2' }
    ];
    const out = await distillPages(pages, { generate });
    assert.equal(out.pages.length, 2);
    assert.equal(out.distilledCount, 2);
    assert.equal(out.products.length, 1); // same sku on both pages -> one product
  });

  test('respects the per-crawl cost cap: pages past maxPages keep their raw text', async () => {
    const generate = async () => ({ text: CLEAN });
    const pages = [{ title: 'a', markdown: RAW }, { title: 'b', markdown: RAW }];
    const out = await distillPages(pages, { generate, maxPages: 1 });
    assert.equal(out.distilledCount, 1);
    assert.equal(out.pages[1].markdown, RAW); // beyond the cap -> untouched
  });
});
