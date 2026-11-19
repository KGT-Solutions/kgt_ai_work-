const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateThemes, sanitizeTheme, sanitizeBrand, sanitizeLogoAppearance, DEFAULT_PRIMARY, FONT_STACKS
} = require('../../src/services/shared/themeGenerator');
const { contrast } = require('../../src/services/shared/color');

// Theme Studio designs: three distinct, readable widget themes from any brand
// kit, and the sanitizers that keep theme values safe to place in CSS.

// Blue, bright yellow, red, black, near-white, green, purple, grey, none.
const BRANDS = ['#1a73e8', '#ffd400', '#e11d48', '#000000', '#f8fafc', '#10b981', '#7c3aed', '#808080', undefined];

describe('themeGenerator: generateThemes', () => {
  test('three distinct designs with stable ids, names, header styles and corners', () => {
    const themes = generateThemes({ primaryColor: '#1a73e8' });
    assert.deepEqual(themes.map((t) => t.id), ['minimal', 'vibrant', 'corporate']);
    assert.deepEqual(themes.map((t) => t.themeName), ['Modern Minimalist', 'Vibrant & Bold', 'Corporate Professional']);
    // Visibly different on every axis a visitor sees. (The brand colour itself
    // can coincide between two designs when it is already fully saturated.)
    for (const key of ['headerStyle', 'borderRadius', 'backgroundColor', 'botBubbleColor', 'fontFamily']) {
      assert.equal(new Set(themes.map((t) => t[key])).size, 3, key);
    }
  });

  test('every design stays readable for any brand colour (WCAG 4.5:1)', () => {
    for (const primaryColor of BRANDS) {
      for (const t of generateThemes({ primaryColor })) {
        const label = `${primaryColor || 'none'} / ${t.id}`;
        assert.ok(contrast(t.onPrimaryColor, t.primaryColor) >= 4.5, `${label}: button text on the brand colour`);
        assert.ok(contrast(t.textColor, t.backgroundColor) >= 4.5, `${label}: text on the background`);
        assert.ok(contrast(t.textColor, t.botBubbleColor) >= 4.5, `${label}: text in the bot bubble`);
        if (t.headerStyle === 'gradient') {
          assert.ok(contrast(t.onPrimaryColor, t.accentColor) >= 4.5, `${label}: header text on the gradient's far end`);
        }
      }
    }
  });

  test('every value is already in its safe, sanitized form', () => {
    for (const primaryColor of BRANDS) {
      for (const t of generateThemes({ primaryColor })) assert.deepEqual(sanitizeTheme(t), t);
    }
  });

  test('with no brand colour the designs are built from the neutral default', () => {
    const [minimal] = generateThemes({});
    assert.equal(minimal.primaryColor, DEFAULT_PRIMARY);
  });

  test("the site's own font leads every stack, and unsafe characters are stripped from it", () => {
    for (const t of generateThemes({ fontHints: ['Poppins'] })) assert.ok(t.fontFamily.startsWith("'Poppins', "), t.fontFamily);
    for (const t of generateThemes({ fontHints: ['Evil;}body{x:url(a)'] })) assert.ok(!/[;{}():]/.test(t.fontFamily), t.fontFamily);
  });
});

describe('themeGenerator: sanitizeTheme', () => {
  test('CSS-injection attempts fall back to safe values', () => {
    const t = sanitizeTheme({
      id: 'minimal',
      primaryColor: 'red;}body{display:none',
      backgroundColor: 'url(javascript:alert(1))',
      fontFamily: 'x;}*{color:red}',
      headerStyle: 'url(javascript:alert(1))',
      borderRadius: '999px',
      themeName: '<script>alert(1)</script>'
    });
    assert.equal(t.primaryColor, DEFAULT_PRIMARY);
    assert.equal(t.backgroundColor, '#ffffff');
    assert.equal(t.fontFamily, FONT_STACKS.system);
    assert.equal(t.headerStyle, 'minimal');
    assert.equal(t.borderRadius, 28);
    assert.ok(!/[<>]/.test(t.themeName));
  });

  test('a theme without a valid id is rejected outright', () => {
    assert.equal(sanitizeTheme(null), null);
    assert.equal(sanitizeTheme({ id: '../../etc' }), null);
    assert.equal(sanitizeTheme({ themeName: 'No id' }), null);
  });
});

describe('themeGenerator: sanitizeBrand', () => {
  test('keeps only http(s) logo URLs without credentials, and valid unique colours', () => {
    const b = sanitizeBrand({
      logoUrl: 'https://cdn.acme.test/logo.png',
      faviconUrl: 'javascript:alert(1)',
      colors: ['#ABC', 'nope', '#abcdef', '#aabbcc'],
      primaryColor: 'blue',
      fontHints: ['Poppins', '<b>', '']
    });
    assert.equal(b.logoUrl, 'https://cdn.acme.test/logo.png');
    assert.equal(b.faviconUrl, null);
    assert.deepEqual(b.colors, ['#aabbcc', '#abcdef']);
    assert.equal(b.primaryColor, null);
    assert.deepEqual(b.fontHints, ['Poppins', 'b']);
    assert.equal(sanitizeBrand({ logoUrl: 'https://user:pw@acme.test/l.png' }).logoUrl, null);
    assert.equal(sanitizeBrand({ logoUrl: 'ftp://acme.test/l.png' }).logoUrl, null);
  });

  test('anything that is not an object yields an empty kit', () => {
    for (const input of [null, undefined, 'x', 42]) {
      const b = sanitizeBrand(input);
      assert.equal(b.logoUrl, null);
      assert.deepEqual(b.colors, []);
    }
  });
});

describe('themeGenerator: logoBadge (how each design seats the logo)', () => {
  const byId = (themes) => Object.fromEntries(themes.map((t) => [t.id, t.logoBadge]));
  const BRAND = { primaryColor: '#1a73e8', logoUrl: 'https://acme.test/logo.png' };

  // minimal = a white header; corporate = a solid brand-colour header.

  const PLAIN = { mode: 'plain', background: null, blend: false, ring: false, tint: null, variant: null };
  const APPEARANCES = [
    null,
    { background: 'transparent', tone: 'dark', monochrome: false },
    { background: 'transparent', tone: 'dark', monochrome: true },
    { background: 'transparent', tone: 'light', monochrome: false },
    { background: 'transparent', tone: 'dark', monochrome: false, reversible: true },
    { background: 'light', backgroundColor: '#fafafa', tone: 'dark' },
    { background: 'color', backgroundColor: '#e4572e', tone: 'light' },
    { background: 'complex', backgroundColor: '#888888', tone: 'dark' }
  ];

  test('every logo, on every design, sits straight on the header: never a chip, plate or tile', () => {
    for (const logoAppearance of APPEARANCES) {
      for (const t of generateThemes({ ...BRAND, logoAppearance })) {
        assert.equal(t.logoBadge.mode, 'plain', `${t.id} / ${JSON.stringify(logoAppearance)}`);
        assert.equal(t.logoBadge.background, null);
      }
    }
  });

  test('an unanalysed or un-cleanable logo blends into a light header, and is shown as-is on a coloured one', () => {
    const b = byId(generateThemes(BRAND));
    assert.deepEqual(b.minimal, { ...PLAIN, blend: true });
    assert.deepEqual(b.corporate, PLAIN);
    const boxed = byId(generateThemes({ ...BRAND, logoAppearance: { background: 'light', backgroundColor: '#fafafa', tone: 'dark' } }));
    assert.deepEqual(boxed.minimal, { ...PLAIN, blend: true });
    assert.deepEqual(boxed.corporate, PLAIN);
  });

  test('a see-through multicolour mark without a variant is shown as-is everywhere (never merged into a silhouette)', () => {
    const b = byId(generateThemes({ ...BRAND, logoAppearance: { background: 'transparent', tone: 'dark', monochrome: false } }));
    assert.deepEqual(b.minimal, PLAIN);
    assert.deepEqual(b.corporate, PLAIN);
  });

  test('a see-through single-colour mark is recoloured instead of boxed where it would vanish', () => {
    const dark = byId(generateThemes({ ...BRAND, logoAppearance: { background: 'transparent', tone: 'dark', monochrome: true } }));
    assert.deepEqual(dark.minimal, { mode: 'plain', background: null, blend: false, ring: false, tint: null, variant: null }, 'contrasts already');
    assert.deepEqual(dark.corporate, { mode: 'plain', background: null, blend: false, ring: false, tint: 'light', variant: null }, 'shown white');
    const light = byId(generateThemes({ ...BRAND, logoAppearance: { background: 'transparent', tone: 'light', monochrome: true } }));
    assert.equal(light.minimal.tint, 'dark');
    assert.equal(light.corporate.tint, null);
  });

  test('a see-through light single-colour mark: as-is on a dark header, tinted dark on a light one', () => {
    const b = byId(generateThemes({ ...BRAND, logoAppearance: { background: 'transparent', tone: 'light', monochrome: true } }));
    assert.deepEqual(b.corporate, PLAIN);
    assert.deepEqual(b.minimal, { ...PLAIN, tint: 'dark' });
  });

  test('a multicolour dark mark with a reversed variant shows that variant on dark headers — no plate', () => {
    const b = byId(generateThemes({ ...BRAND, logoAppearance: { background: 'transparent', tone: 'dark', monochrome: false, reversible: true } }));
    assert.deepEqual(b.corporate, { mode: 'plain', background: null, blend: false, ring: false, tint: null, variant: 'reversed' });
    assert.equal(b.minimal.variant, null, 'the original already reads on a light header');
    assert.equal(sanitizeTheme({ id: 'minimal', logoBadge: { mode: 'pill', variant: 'reversed' } }).logoBadge.variant, null,
      'only a plain mark swaps to the variant');
  });

  test('sanitizeLogoAppearance keeps only well-formed analyses', () => {
    assert.equal(sanitizeLogoAppearance(null), null);
    assert.equal(sanitizeLogoAppearance({ background: 'glitter', tone: 'dark' }), null);
    assert.equal(sanitizeLogoAppearance({ background: 'light', tone: 'dark' }), null, 'a solid box needs its colour');
    assert.deepEqual(sanitizeLogoAppearance({ background: 'transparent', backgroundColor: '#ffffff', tone: 'nope' }),
      { background: 'transparent', backgroundColor: null, tone: 'dark', monochrome: false });
    assert.equal(sanitizeBrand({ logoAppearance: { background: 'transparent', tone: 'dark' } }).logoAppearance, null,
      'no logo, no analysis');
  });

  test('a malformed or stored-without-badge theme gets the safe default badge', () => {
    assert.deepEqual(sanitizeTheme({ id: 'minimal' }).logoBadge, { mode: 'plain', background: null, blend: true, ring: false, tint: null, variant: null });
    assert.deepEqual(sanitizeTheme({ id: 'minimal', logoBadge: { mode: 'tile', background: 'red;}', blend: 'yes', tint: 'light', variant: null } }).logoBadge,
      { mode: 'tile', background: '#ffffff', blend: false, ring: false, tint: null, variant: null }, 'a tint only applies to a plain mark');
    assert.equal(sanitizeTheme({ id: 'minimal', logoBadge: { mode: 'plain', background: '#000000' } }).logoBadge.background, null);
    assert.equal(sanitizeTheme({ id: 'minimal', logoBadge: { mode: 'plain', tint: 'url(x)' } }).logoBadge.tint, null);
  });
});
