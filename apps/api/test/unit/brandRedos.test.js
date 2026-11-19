const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

require('../../src/services/shared/crawler'); // applies the Node 18 `File` polyfill cheerio needs
const cheerio = require('cheerio');
const { normalizeColor, extractBrandSignals, MAX_COLOR_CHARS } = require('../../src/services/shared/brandExtractor');

// ReDoS regression (adversarial review, Critical). normalizeColor reads the
// page's <meta name="theme-color"> — page-controlled, reached by the
// unauthenticated POST /public/register/analyze — and its rgb regex was
// quadratic: "rgb(1" + 64,000 spaces took 3 s; a 3 MB page ~110 minutes.

const MB3 = 3 * 1024 * 1024;
const elapsed = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

describe('normalizeColor: linear on hostile input', () => {
  test('a 3 MB space-padded theme-color is refused in under 50 ms', () => {
    for (const hostile of ['rgb(1' + ' '.repeat(MB3) + 'x', 'rgba(1,' + ' '.repeat(MB3), 'rgb(' + '1 '.repeat(MB3 / 2)]) {
      let out;
      const ms = elapsed(() => { out = normalizeColor(hostile); });
      assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
      assert.equal(out, null);
    }
  });

  test('surrounding whitespace is trimmed (linearly) before the cap: a padded real colour still parses', () => {
    let out;
    const ms = elapsed(() => { out = normalizeColor(' '.repeat(MB3) + '#fff' + ' '.repeat(MB3)); });
    assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
    assert.equal(out, '#ffffff');
  });

  test('anything longer than the cap is refused before any regex runs', () => {
    assert.equal(MAX_COLOR_CHARS, 64);
    assert.equal(normalizeColor(`rgb(1, 2, 3${' '.repeat(60)})`), null);
  });

  test('a run of spaces just inside the cap is still linear (the regex itself is safe)', () => {
    const s = 'rgb(1' + ' '.repeat(MAX_COLOR_CHARS - 8) + 'x';
    const ms = elapsed(() => { for (let i = 0; i < 10000; i++) normalizeColor(s); });
    assert.ok(ms < 500, `10,000 calls took ${ms.toFixed(0)} ms`);
  });

  test('every real colour form still parses', () => {
    const cases = {
      '#1A73E8': '#1a73e8', '#abc': '#aabbcc', '#1a73e8ff': '#1a73e8', '#1a73e810': null,
      'rgb(26, 115, 232)': '#1a73e8', 'rgb(26,115,232)': '#1a73e8', 'rgb(26 115 232)': '#1a73e8',
      'rgba(26, 115, 232, 0.9)': '#1a73e8', 'rgb(26 115 232 / 90%)': '#1a73e8', 'rgba(26,115,232,0.2)': null,
      '  RGB( 26 , 115 , 232 )  ': '#1a73e8', 'rgb(300, 0, 0)': null, 'red': null, '': null
    };
    for (const [input, expected] of Object.entries(cases)) assert.equal(normalizeColor(input), expected, input);
  });
});

describe('extractBrandSignals: a hostile theme-color meta does not stall the scan', () => {
  test('a page whose theme-color is ~1 MB of padding is read quickly, colour ignored', () => {
    const html = `<html><head><meta name="theme-color" content="rgb(1${' '.repeat(1024 * 1024)}x">` +
      `<meta name="msapplication-TileColor" content="rgba(2,${' '.repeat(1024 * 1024)}"></head><body><p>hi</p></body></html>`;
    const $ = cheerio.load(html);
    let signals;
    const ms = elapsed(() => { signals = extractBrandSignals($, 'https://evil.test/'); });
    assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
    assert.equal(signals.themeColor, null);
  });

  test('a normal theme-color is still used', () => {
    const signals = extractBrandSignals(cheerio.load('<meta name="theme-color" content="#0d9488">'), 'https://acme.test/');
    assert.equal(signals.themeColor, '#0d9488');
  });
});
