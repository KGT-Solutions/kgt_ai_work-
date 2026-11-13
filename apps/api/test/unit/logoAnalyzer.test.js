const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { analyzeLogo } = require('../../src/services/shared/logoAnalyzer');

// Logo analysis for the Theme Studio: does the image carry a box behind the
// mark, and is the mark light or dark? Real images, built with sharp.

const canvas = (w, h, background) => sharp({ create: { width: w, height: h, channels: 4, background } });
const rect = (w, h, r, g, b) => canvas(w, h, { r, g, b, alpha: 1 }).png().toBuffer();
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

async function logo(background, mark) {
  return canvas(120, 60, background).composite([{ input: await mark, top: 15, left: 20 }]).png().toBuffer();
}

describe('logoAnalyzer: background and tone', () => {
  test('a see-through logo with a dark mark', async () => {
    assert.deepEqual(await analyzeLogo(await logo(CLEAR, rect(80, 30, 17, 24, 39))),
      { background: 'transparent', backgroundColor: null, tone: 'dark', monochrome: true });
  });

  test('a see-through logo with a white mark (made for dark headers)', async () => {
    assert.deepEqual(await analyzeLogo(await logo(CLEAR, rect(80, 30, 255, 255, 255))),
      { background: 'transparent', backgroundColor: null, tone: 'light', monochrome: true });
  });

  test('a dark mark inside a white box', async () => {
    assert.deepEqual(await analyzeLogo(await logo({ r: 255, g: 255, b: 255, alpha: 1 }, rect(80, 30, 17, 24, 39))),
      { background: 'light', backgroundColor: '#ffffff', tone: 'dark', monochrome: true });
  });

  test('a white mark on a coloured tile', async () => {
    const out = await analyzeLogo(await logo({ r: 228, g: 87, b: 46, alpha: 1 }, rect(80, 30, 255, 255, 255)));
    assert.equal(out.background, 'color');
    assert.equal(out.backgroundColor, '#e4572e');
    assert.equal(out.tone, 'light');
  });

  test('a black box with a light mark', async () => {
    const out = await analyzeLogo(await logo({ r: 0, g: 0, b: 0, alpha: 1 }, rect(80, 30, 240, 240, 240)));
    assert.equal(out.background, 'dark');
    assert.equal(out.tone, 'light');
  });

  test('an SVG logo is rasterised and read like any other', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect x="12" y="10" width="136" height="28" fill="#111827"/></svg>');
    assert.deepEqual(await analyzeLogo(svg), { background: 'transparent', backgroundColor: null, tone: 'dark', monochrome: true });
  });

  test('a multicolour mark is not monochrome (it must not be recoloured)', async () => {
    const twoTone = canvas(120, 60, CLEAR).composite([
      { input: await rect(40, 30, 220, 38, 38), top: 15, left: 20 },
      { input: await rect(40, 30, 37, 99, 235), top: 15, left: 60 }
    ]).png().toBuffer();
    assert.equal((await analyzeLogo(await twoTone)).monochrome, false);
  });
});

describe('logoAnalyzer: never throws', () => {
  test('unreadable bytes, an empty buffer or a missing sharp give null', async () => {
    assert.equal(await analyzeLogo(Buffer.from('not an image at all')), null);
    assert.equal(await analyzeLogo(Buffer.alloc(0)), null);
    assert.equal(await analyzeLogo('a string'), null);
    assert.equal(await analyzeLogo(await logo(CLEAR, rect(80, 30, 0, 0, 0)), { sharp: null }), null);
  });
});
