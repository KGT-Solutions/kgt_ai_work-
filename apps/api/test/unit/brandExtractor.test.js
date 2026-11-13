const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

require('../../src/services/shared/crawler'); // applies the Node 18 `File` polyfill cheerio needs
const cheerio = require('cheerio');
const {
  extractBrandSignals, resolveBrand, normalizeColor, harvestColors
} = require('../../src/services/shared/brandExtractor');

// Pure brand extraction (Theme Studio): logo choice, colour palette and font
// hints from a homepage's HTML and CSS. No network — crawler.js fetches.

const PAGE = 'https://www.acme.test/en/';
const signalsOf = (html) => extractBrandSignals(cheerio.load(html), PAGE);
const brandOf = (html, css = []) => resolveBrand(signalsOf(html), css);

describe('brandExtractor: logo', () => {
  test('a header <img> marked as the logo beats og:image, the touch icon and the favicon', () => {
    const s = signalsOf(`<html><head>
      <meta property="og:image" content="/social-banner.jpg">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      </head><body><header><a class="site-logo" href="/"><img src="/img/acme-logo.svg" alt="Acme"></a></header>
      <main><img src="/hero.jpg" alt="Summer sale"></main></body></html>`);
    assert.equal(s.logoUrl, 'https://www.acme.test/img/acme-logo.svg');
    assert.equal(s.faviconUrl, 'https://www.acme.test/favicon-32.png');
  });

  test('falls back through the apple-touch-icon, then og:image, then the icon', () => {
    const icon = '<link rel="icon" href="/fav.png">';
    const og = '<meta property="og:image" content="https://cdn.acme.test/og.png">';
    const touch = '<link rel="apple-touch-icon" href="/touch.png">';
    assert.equal(signalsOf(`<head>${icon}${og}${touch}</head>`).logoUrl, 'https://www.acme.test/touch.png');
    assert.equal(signalsOf(`<head>${icon}${og}</head>`).logoUrl, 'https://cdn.acme.test/og.png');
    assert.equal(signalsOf(`<head>${icon}</head>`).logoUrl, 'https://www.acme.test/fav.png');
  });

  test('"brand" counts only in the header, and data:/javascript: images are never used', () => {
    assert.equal(signalsOf('<main><div class="brands-we-carry"><img src="/partner.png"></div></main>').logoUrl, null);
    assert.equal(signalsOf('<header><div class="navbar-brand"><img src="/mark.png"></div></header>').logoUrl, 'https://www.acme.test/mark.png');
    assert.equal(signalsOf('<header><img class="logo" src="data:image/png;base64,AAAA"></header>').logoUrl, null);
    assert.equal(signalsOf('<header><img class="logo" src="javascript:alert(1)"></header>').logoUrl, null);
  });

  test('with no candidates the logo is null and the favicon is guessed at /favicon.ico', () => {
    const s = signalsOf('<html><body><p>Hello</p></body></html>');
    assert.equal(s.logoUrl, null);
    assert.equal(s.faviconUrl, 'https://www.acme.test/favicon.ico');
  });
});

describe('brandExtractor: colours', () => {
  test('theme-color is the primary colour, even when it is dark and muted', () => {
    const b = brandOf('<head><meta name="theme-color" content="#1F3A5F"><style>.btn{background:#e4572e}</style></head>');
    assert.equal(b.primaryColor, '#1f3a5f');
    assert.equal(b.secondaryColor, '#e4572e');
  });

  test('a --brand-primary custom property outweighs a colour merely used often', () => {
    const b = brandOf(`<style>:root{--brand-primary:#0d9488}
      a{color:#e11d48} a:hover{color:#e11d48} .tag{border-color:#e11d48}</style>`);
    assert.equal(b.primaryColor, '#0d9488');
  });

  test('greys, white, black and translucent colours say nothing about the brand', () => {
    const b = brandOf(`<style>body{color:#333;background:#fff} footer{background:#000}
      .overlay{background:rgba(255,0,0,.2)} .card{border:1px solid #e5e7eb}</style>`);
    assert.deepEqual(b.colors, []);
    assert.equal(b.primaryColor, null);
    assert.equal(b.secondaryColor, null);
    assert.equal(b.accentColor, null);
  });

  test('near-identical shades merge, and secondary/accent are distinct colours', () => {
    const b = brandOf(`<style>.a{background:#1a73e8}.b{background:#1a73e8}.c{background:#1a73e8}
      .d{background:#1b74e9}.e{background:#34a853}.f{background:#fbbc05}</style>`);
    assert.equal(b.primaryColor, '#1a73e8');
    assert.ok(!b.colors.includes('#1b74e9'), 'the near-duplicate shade was merged');
    assert.deepEqual(new Set([b.secondaryColor, b.accentColor]), new Set(['#34a853', '#fbbc05']));
  });

  test('inline style attributes count too', () => {
    assert.equal(brandOf('<body><a style="background-color: rgb(124, 58, 237); color:#fff">Shop</a></body>').primaryColor, '#7c3aed');
  });

  test('linked stylesheet text is merged in; framework stylesheets are skipped, own-site ones first', () => {
    const s = signalsOf(`<head>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css">
      <link rel="stylesheet" href="https://cdn.other.test/widget.css">
      <link rel="stylesheet" href="/css/site.css"></head>`);
    assert.deepEqual(s.stylesheetUrls, ['https://www.acme.test/css/site.css', 'https://cdn.other.test/widget.css']);
    assert.equal(resolveBrand(s, ['.btn-primary{background:#7c3aed}']).primaryColor, '#7c3aed');
  });

  test('normalizeColor reads hex, short hex and rgb(a), and rejects translucent or invalid values', () => {
    assert.equal(normalizeColor('#ABC'), '#aabbcc');
    assert.equal(normalizeColor('#1A73E8'), '#1a73e8');
    assert.equal(normalizeColor('#1a73e8ff'), '#1a73e8');
    assert.equal(normalizeColor('#1a73e840'), null);
    assert.equal(normalizeColor('rgb(26, 115, 232)'), '#1a73e8');
    assert.equal(normalizeColor('rgba(26,115,232,0.9)'), '#1a73e8');
    assert.equal(normalizeColor('rgba(26,115,232,0.3)'), null);
    assert.equal(normalizeColor('rgb(300, 0, 0)'), null);
    assert.equal(normalizeColor('red'), null);
  });
});

describe('brandExtractor: font hints', () => {
  test('the first real family wins; system, generic and icon fonts are skipped', () => {
    const { fonts } = harvestColors([`body{font-family:"Poppins",-apple-system,sans-serif}
      .i{font-family:'Font Awesome 6 Free'} h1{font-family:Poppins, serif} code{font-family:monospace}`]);
    assert.equal(fonts[0], 'Poppins');
    assert.ok(!fonts.some((f) => /awesome|monospace/i.test(f)));
  });
});

// ── Regressions for the adversarial review ─────────────────────────────────
const { stripComments, COLOR_TOKEN_RE, MAX_DECLARATION_CHARS } = require('../../src/services/shared/brandExtractor');

const elapsedMs = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
const BUDGET = 600 * 1024; // the CSS this extractor will read from one page

describe('brandExtractor: hostile CSS stays linear (ReDoS)', () => {
  // The old regexes were measured quadratic: these inputs cost them from ~13 s
  // to ~6 min of blocked event loop. Linear code takes milliseconds.
  test('the colour regex on an unterminated rgb( and 200,000 spaces', () => {
    const value = `rgb(1${' '.repeat(200000)}x`;
    assert.ok(elapsedMs(() => value.match(COLOR_TOKEN_RE)) < 200);
  });

  test('600 KB of word characters with no colon', () => {
    assert.ok(elapsedMs(() => harvestColors(['a'.repeat(BUDGET)])) < 1500);
  });

  test('600 KB of unclosed comments', () => {
    assert.ok(elapsedMs(() => harvestColors(['/* x '.repeat(BUDGET / 5)])) < 1500);
  });

  test('an over-long declaration value is skipped before any colour matching', () => {
    assert.ok(elapsedMs(() => harvestColors([`.a{color:rgb(1${' '.repeat(BUDGET)}x}`])) < 1500);
  });

  test('the fixed colour regex still reads every colour syntax it read before', () => {
    const tokens = 'a #ABC b #1a73e8 c #1a73e8ff d rgb(26, 115, 232) e rgba(26 115 232 / 0.9) f rgb(1,2,3)'.match(COLOR_TOKEN_RE);
    assert.deepEqual(tokens, ['#ABC', '#1a73e8', '#1a73e8ff', 'rgb(26, 115, 232)', 'rgba(26 115 232 / 0.9)', 'rgb(1,2,3)']);
  });
});

describe('brandExtractor: stripComments', () => {
  test('removes comments, keeps everything else, and an unclosed comment runs to the end', () => {
    assert.equal(stripComments('a{color:red}/* c1 */b{x:1}/* c2 */'), 'a{color:red} b{x:1} ');
    assert.equal(stripComments('a{x:1}/* never closed b{y:2}'), 'a{x:1} ');
    assert.equal(stripComments('no comments'), 'no comments');
    assert.equal(stripComments(null), '');
  });
});

describe('brandExtractor: declaration length cap', () => {
  test(`a value over ${MAX_DECLARATION_CHARS} characters is ignored; normal ones beside it still count`, () => {
    const { ranked } = harvestColors([`.big{background:${'#7c3aed '.repeat(600)}} .ok{background:#0d9488}`]);
    assert.ok(ranked.includes('#0d9488'));
    assert.ok(!ranked.includes('#7c3aed'));
  });
});

describe('brandExtractor: logo scoring (footers, logo walls, lazy loading)', () => {
  test('logos in the footer (payment badges, partners) are never the brand logo', () => {
    const s = signalsOf('<head><link rel="icon" href="/fav.png"></head><footer><img src="/visa.png" alt="Visa logo"></footer>');
    assert.equal(s.logoUrl, 'https://www.acme.test/fav.png');
    assert.equal(signalsOf('<div role="contentinfo"><img class="logo" src="/cert.png"></div>').logoUrl, null);
  });

  test('a "Trusted by" wall of client logos is ignored in favour of the site\'s own icon', () => {
    const s = signalsOf(`<head><link rel="apple-touch-icon" href="/own-touch.png"></head>
      <header><a href="/" class="brand"><svg><path d="M0 0"/></svg></a></header>
      <section><h2>Trusted by</h2><img src="/c/globex.png" alt="Globex logo"><img src="/c/initech.png" alt="Initech logo">
      <img src="/c/umbrella.png" alt="Umbrella logo"></section>`);
    assert.equal(s.logoUrl, 'https://www.acme.test/own-touch.png');
  });

  test('a single logo image outside the header still counts, above og:image', () => {
    const s = signalsOf('<head><meta property="og:image" content="/banner.jpg"></head><main><img src="/acme.png" alt="Acme logo"></main>');
    assert.equal(s.logoUrl, 'https://www.acme.test/acme.png');
  });

  test('a lazy-loaded logo is found behind its data: placeholder (data-src, srcset, data-srcset)', () => {
    const lazy = (attrs) => signalsOf(`<header><img class="logo" src="data:image/gif;base64,R0lGOD" ${attrs}></header>`).logoUrl;
    assert.equal(lazy('data-src="/real.png"'), 'https://www.acme.test/real.png');
    assert.equal(lazy('srcset="/real-1x.png 1x, /real-2x.png 2x"'), 'https://www.acme.test/real-1x.png');
    assert.equal(lazy('data-srcset="/lazy.png 1x"'), 'https://www.acme.test/lazy.png');
    assert.equal(lazy(''), null, 'only a placeholder: no logo');
  });
});
