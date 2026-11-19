const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { generateThemes, sanitizeTheme, mutedHeaderColor, headerSurfaces, sanitizeBrand, MUTED_MIN_CONTRAST } = require('../../src/services/shared/themeGenerator');
const { contrast } = require('../../src/services/shared/color');
const { analyzeLogo, MAX_INPUT_PIXELS } = require('../../src/services/shared/logoAnalyzer');
const branding = require('../../src/services/branding');

// Hardening from the branding adversarial review: WCAG contrast of muted
// header text, the logo analyser's pixel cap, and invisible-character
// sanitising of the bot name and ingested text.

const everyBrandColour = () => Array.from({ length: 4096 }, (_, i) =>
  '#' + [(i >> 8) * 17, ((i >> 4) & 15) * 17, (i & 15) * 17].map((v) => v.toString(16).padStart(2, '0')).join(''));

describe('muted header text meets WCAG AA (4.5:1) on every header surface', () => {
  test('all 12,288 designs from 4,096 brand colours: inactive tabs, chips and close button pass on every surface', () => {
    let worst = Infinity;
    let worstCase = '';
    for (const hex of everyBrandColour()) {
      for (const t of generateThemes({ primaryColor: hex })) {
        assert.match(t.headerMutedColor, /^#[0-9a-f]{6}$/);
        for (const surface of headerSurfaces(t)) {
          const c = contrast(t.headerMutedColor, surface);
          if (c < worst) { worst = c; worstCase = `${t.id} from ${hex}: ${t.headerMutedColor} on ${surface}`; }
        }
      }
    }
    assert.ok(worst >= MUTED_MIN_CONTRAST, `worst ${worst.toFixed(2)}:1 — ${worstCase}`);
  });

  test('a gradient header checks BOTH ends (the accent end failed at 3.16:1 before)', () => {
    const t = generateThemes({ primaryColor: '#003388' }).find((x) => x.headerStyle === 'gradient');
    assert.ok(contrast(t.headerMutedColor, t.primaryColor) >= 4.5);
    assert.ok(contrast(t.headerMutedColor, t.accentColor) >= 4.5);
  });

  test('it stays muted where it can: not simply the full-strength header ink', () => {
    const minimal = generateThemes({ primaryColor: '#4f46e5' }).find((x) => x.id === 'minimal');
    assert.notEqual(minimal.headerMutedColor, minimal.textColor);
  });

  test('derived on every read, never trusted from storage: an old theme without it, or a tampered one, gets a compliant colour', () => {
    const stored = { ...generateThemes({ primaryColor: '#ee0000' })[1] };
    delete stored.headerMutedColor;
    const fromOld = sanitizeTheme(stored);
    for (const s of headerSurfaces(fromOld)) assert.ok(contrast(fromOld.headerMutedColor, s) >= 4.5);
    const tampered = sanitizeTheme({ ...stored, headerMutedColor: '#ee0001' });
    assert.equal(tampered.headerMutedColor, fromOld.headerMutedColor);
  });

  test('a malformed stored theme whose ink fails still gets the better of white or dark', () => {
    const t = { headerStyle: 'solid', primaryColor: '#777777', onPrimaryColor: '#808080', textColor: '#0f172a', backgroundColor: '#ffffff', accentColor: '#777777' };
    assert.ok(['#ffffff', '#0f172a'].includes(mutedHeaderColor(t)));
  });

  test('the widget and the Studio use the server\'s colour', () => {
    const widget = fs.readFileSync(path.join(__dirname, '../../public/widgets/tenant-chat-widget.js'), 'utf8');
    assert.match(widget, /head\.muted = hexOr\(th\.headerMutedColor, head\.muted\)/);
  });
});

describe('logo analyser pixel cap', () => {
  test('a pixel bomb (36 MP in a small PNG) is refused fast — the logo is treated as unanalysed', async () => {
    assert.equal(MAX_INPUT_PIXELS, 25 * 1000 * 1000);
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#ffffff' } }).png({ compressionLevel: 9 }).toBuffer();
    const t = process.hrtime.bigint();
    const out = await analyzeLogo(bomb);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.equal(out, null);
    assert.ok(ms < 200, `refused in ${ms.toFixed(0)} ms`);
  });

  test('a normal large logo under the cap is still analysed', async () => {
    const ok = await sharp({ create: { width: 2000, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="800"><rect x="200" y="200" width="1600" height="400" fill="#111827"/></svg>'), top: 0, left: 0 }])
      .png().toBuffer();
    assert.equal((await analyzeLogo(ok)).background, 'transparent');
  });
});

describe('invisible formatting characters are stripped', () => {
  const NASTY = 'Sup\u200Bport\u202E\u2066 Bot\uFEFF\u200F\u2069';

  test('cleanBotName removes zero-width, bidi override/isolate and BOM characters', () => {
    assert.equal(branding.cleanBotName(NASTY), 'Support Bot');
    for (const ch of ['\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2060', '\u2066', '\u2067', '\u2068', '\u2069', '\uFEFF']) {
      assert.equal(branding.cleanBotName(`A${ch}B`), 'AB', `U+${ch.charCodeAt(0).toString(16)}`);
    }
    assert.equal(branding.cleanBotName('Café Ünïcödé 日本 Bot'), 'Café Ünïcödé 日本 Bot', 'real text is untouched');
  });

  test('a name made only of invisible characters is refused, not stored blank', async () => {
    const state = { row: null };
    const prisma = {
      tenantBranding: { findUnique: async () => state.row, upsert: async ({ create }) => (state.row = { id: 'b', ...create }), update: async ({ data }) => (state.row = { ...state.row, ...data }) },
      tenantLogoAsset: { deleteMany: async () => ({ count: 0 }) },
      tenantConsent: { findFirst: async () => null }
    };
    await assert.rejects(branding.updateBrandKit({ id: 't', name: 'A' }, { botName: '\u202E\u200B\uFEFF' }, { prisma }), /at least one letter/);
    const view = await branding.updateBrandKit({ id: 't', name: 'A' }, { botName: NASTY }, { prisma });
    assert.equal(view.botName, 'Support Bot');
  });

  test('no source file carries a raw invisible or bidi character (Trojan Source guard)', () => {
    // Built from char codes, so this test can't itself contain the characters.
    const ranges = [[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|jsx|ts|tsx|prisma|sql)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          for (const ch of text) {
            const code = ch.codePointAt(0);
            if (ranges.some(([lo, hi]) => code >= lo && code <= hi)) { offenders.push(`${path.relative(path.join(__dirname, '../..'), full)} U+${code.toString(16)}`); break; }
          }
        }
      }
    };
    for (const dir of ['../../src', '../../public', '../../prisma', '../../test', '../../../web/components', '../../../web/lib', '../../../web/pages']) {
      const full = path.join(__dirname, dir);
      if (fs.existsSync(full)) walk(full);
    }
    assert.deepEqual(offenders, [], 'write such characters as \\uXXXX escapes, never raw');
  });

  test('ingested text (a scanned site name) is stripped too', () => {
    assert.equal(sanitizeBrand({ siteName: 'Acme\u202E Corp\u200B' }).siteName, 'Acme Corp');
  });

  test('the widget strips the same set at render time', () => {
    const widget = fs.readFileSync(path.join(__dirname, '../../public/widgets/tenant-chat-widget.js'), 'utf8');
    assert.ok(widget.includes('.replace(/[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]/g, \'\')'));
  });
});
