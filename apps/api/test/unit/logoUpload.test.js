const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  processLogoUpload, sniffImageType, logoAssetPath, LogoUploadError, MAX_LOGO_EDGE, MAX_LOGO_UPLOAD_BYTES
} = require('../../src/services/shared/logoUpload');

// Logo uploads (Theme Studio): only real PNG/JPEG/WebP bytes are accepted, and
// what is stored is a fresh PNG re-encoding — never the uploaded file.

const image = (w, h, format = 'png', { alpha = true } = {}) => sharp({
  create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 20, g: 120, b: 220, alpha: 0.5 } : { r: 20, g: 120, b: 220 } }
})[format]().toBuffer();

const rejects = (promise, status, re) => assert.rejects(promise, (e) => e instanceof LogoUploadError && e.statusCode === status && re.test(e.message));

describe('sniffImageType: by the bytes, not the name', () => {
  test('recognises PNG, JPEG and WebP', async () => {
    assert.equal(sniffImageType(await image(32, 32, 'png')), 'image/png');
    assert.equal(sniffImageType(await image(32, 32, 'jpeg', { alpha: false })), 'image/jpeg');
    assert.equal(sniffImageType(await image(32, 32, 'webp')), 'image/webp');
  });

  test('SVG, HTML, GIF and empty input are not images it accepts', () => {
    for (const s of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', '<!doctype html><script>alert(1)</script>', 'GIF89a\x01\x00\x01\x00\x00\x00\x00', '']) {
      assert.equal(sniffImageType(Buffer.from(s)), null, s.slice(0, 20));
    }
  });
});

describe('processLogoUpload', () => {
  test('re-encodes to PNG, keeps transparency, and returns a content key', async () => {
    const out = await processLogoUpload(await image(200, 100, 'webp'));
    assert.equal(out.mimeType, 'image/png');
    assert.equal(sniffImageType(out.data), 'image/png');
    assert.deepEqual([out.width, out.height], [200, 100]);
    assert.match(out.key, /^[0-9a-f]{24}$/);
    const meta = await sharp(out.data).metadata();
    assert.equal(meta.hasAlpha, true, 'transparency survives');
  });

  test('the key depends only on the result, so the same image gives the same URL', async () => {
    const buf = await image(64, 64);
    assert.equal((await processLogoUpload(buf)).key, (await processLogoUpload(buf)).key);
  });

  test('large logos are scaled down to fit 512px; small ones are not blown up', async () => {
    const big = await processLogoUpload(await image(2000, 1000, 'jpeg', { alpha: false }));
    assert.deepEqual([big.width, big.height], [MAX_LOGO_EDGE, MAX_LOGO_EDGE / 2]);
    const small = await processLogoUpload(await image(40, 40));
    assert.deepEqual([small.width, small.height], [40, 40]);
  });

  test('EXIF and other metadata are stripped', async () => {
    const withExif = await sharp(await image(64, 64, 'jpeg', { alpha: false }))
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner', Artist: 'someone' } } }).jpeg().toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif, 'the fixture really carries EXIF');
    const out = await processLogoUpload(withExif);
    const meta = await sharp(out.data).metadata();
    assert.equal(meta.exif, undefined);
    assert.ok(!out.data.includes(Buffer.from('secret-gps-owner')));
  });

  test('an SVG or HTML file renamed to .png is refused (400), whatever its declared type', async () => {
    await rejects(processLogoUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), 400, /PNG, JPEG or WebP/);
    await rejects(processLogoUpload(Buffer.from('<!doctype html><html><body>hi</body></html>')), 400, /PNG, JPEG or WebP/);
  });

  test('a PNG signature followed by garbage is refused as unreadable', async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<script>alert(1)</script>'.repeat(4))]);
    await rejects(processLogoUpload(fake), 400, /couldn’t be read/);
  });

  test('a polyglot (real PNG with HTML appended) is stored as clean pixels only', async () => {
    const polyglot = Buffer.concat([await image(32, 32), Buffer.from('<script>alert(document.cookie)</script>')]);
    const out = await processLogoUpload(polyglot).catch((e) => e);
    if (out instanceof LogoUploadError) return assert.equal(out.statusCode, 400); // refused outright is fine too
    assert.ok(!out.data.includes(Buffer.from('<script>')), 'the appended payload is gone');
  });

  test('a tiny image is refused', async () => {
    await rejects(processLogoUpload(await image(8, 8)), 400, /too small/);
  });

  test('a pixel-bomb (huge declared dimensions in a small file) is refused with 413 without decoding it', async () => {
    const bomb = await sharp({ create: { width: 10000, height: 10000, channels: 3, background: '#ffffff' } }).png({ compressionLevel: 9 }).toBuffer();
    assert.ok(bomb.length < MAX_LOGO_UPLOAD_BYTES, `the bomb fits the upload cap (${bomb.length} bytes)`);
    const started = Date.now();
    await rejects(processLogoUpload(bomb), 413, /too many pixels/);
    assert.ok(Date.now() - started < 3000);
  });

  test('over 2 MB is a 413; nothing at all is a 400', async () => {
    await rejects(processLogoUpload(Buffer.alloc(MAX_LOGO_UPLOAD_BYTES + 1)), 413, /2MB/);
    await rejects(processLogoUpload(Buffer.alloc(0)), 400, /Choose an image/);
  });

  test('without the image library, uploads say so (503) instead of storing an unchecked file', async () => {
    await rejects(processLogoUpload(await image(32, 32), { sharp: null }), 503, /aren’t available/);
  });
});

// ── Background knockout: a logo exported on a white rectangle must show only
// its artwork on a coloured or gradient chat header.
describe('prepareLogo: white-box knockout', () => {
  const { prepareLogo, knockoutBackground } = require('../../src/services/shared/logoUpload');
  // Dark "wordmark" with a hollow letter (a ring whose counter is white) on a white box.
  const boxedLogo = (bg = { r: 255, g: 255, b: 255, alpha: 1 }, format = 'png') => sharp({ create: { width: 300, height: 120, channels: 4, background: bg } })
    .composite([{
      input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120">' +
        '<circle cx="70" cy="60" r="34" fill="none" stroke="#2563eb" stroke-width="6"/>' + // a letter-weight stroke in a mid brand blue
        '<rect x="130" y="34" width="140" height="52" rx="6" fill="#111827"/></svg>'),
      top: 0, left: 0
    }])[format]()
    .toBuffer();
  const pixelAt = async (png, x, y) => {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (Math.min(y, info.height - 1) * info.width + Math.min(x, info.width - 1)) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], w: info.width, h: info.height };
  };

  test('the white box becomes transparent, the artwork keeps its colour, and the margins are trimmed', async () => {
    const out = await prepareLogo(await boxedLogo());
    assert.equal(out.knockedOut, true);
    assert.equal(out.original.background, 'light');
    assert.equal(out.appearance.background, 'transparent');
    assert.ok(out.width < 300 && out.height < 120, `trimmed to the artwork (${out.width}×${out.height})`);
    const corner = await pixelAt(out.data, 0, 0);
    const ink = await pixelAt(out.data, out.width - 20, Math.round(out.height / 2)); // inside the dark bar
    assert.ok(ink.a > 240 && ink.r < 40 && ink.b < 60, `artwork stays solid and dark: ${JSON.stringify(ink)}`);
    assert.ok(corner.a < 255, 'corner is no longer opaque white');
  });

  test('the counter inside a hollow letter goes too (no white blobs inside letters)', async () => {
    const out = await prepareLogo(await boxedLogo());
    // The ring's centre, relative to the trimmed image: the ring is the leftmost
    // artwork, so its centre sits ~one radius+stroke in from the left edge.
    const centre = await pixelAt(out.data, 41, Math.round(out.height / 2));
    assert.ok(centre.a < 10, `counter is see-through: ${JSON.stringify(centre)}`);
  });

  test('white artwork inside a coloured shape stays solid white (the initial in an emblem)', async () => {
    const emblem = await sharp({ create: { width: 240, height: 120, channels: 3, background: '#ffffff' } })
      .composite([{
        input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120">' +
          '<circle cx="60" cy="60" r="44" fill="#2563eb"/><rect x="48" y="36" width="24" height="48" fill="#ffffff"/>' +
          '<rect x="130" y="40" width="90" height="40" fill="#0f172a"/></svg>'),
        top: 0, left: 0
      }]).png().toBuffer();
    const out = await prepareLogo(emblem);
    assert.equal(out.knockedOut, true);
    const inner = await pixelAt(out.data, 44, Math.round(out.height / 2)); // inside the white bar in the circle
    assert.ok(inner.a === 255 && inner.r > 240 && inner.g > 240 && inner.b > 240, `stays opaque white: ${JSON.stringify(inner)}`);
    assert.equal((await pixelAt(out.data, 0, 0)).a, 0, 'the box outside the emblem is still removed');
  });

  test('anti-aliased edges become soft alpha in the artwork colour, not a white fringe', async () => {
    const out = await prepareLogo(await boxedLogo());
    const { data } = await sharp(out.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let fringe = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 20 && a < 235 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) fringe += 1;
    }
    assert.equal(fringe, 0, 'no semi-transparent near-white pixels');
  });

  test('JPEG noise around an off-white box is removed as well', async () => {
    const out = await prepareLogo(await boxedLogo({ r: 248, g: 247, b: 244, alpha: 1 }, 'jpeg'));
    assert.equal(out.knockedOut, true);
    const { data } = await sharp(out.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let speckles = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 40 && data[i] > 200 && data[i + 1] > 200) speckles += 1;
    assert.equal(speckles, 0, 'no visible off-white speckles left');
  });

  test('a coloured or black block behind the artwork is removed too; a transparent logo is left alone', async () => {
    for (const bg of [{ r: 228, g: 87, b: 46, alpha: 1 }, { r: 0, g: 0, b: 0, alpha: 1 }]) {
      const out = await prepareLogo(await boxedLogo(bg));
      assert.equal(out.knockedOut, true, JSON.stringify(bg));
      assert.equal(out.appearance.background, 'transparent');
      assert.equal((await pixelAt(out.data, 0, 0)).a < 255 || out.width < 300, true, 'the block is gone');
    }
    const clear = await prepareLogo(await boxedLogo({ r: 0, g: 0, b: 0, alpha: 0 }));
    assert.equal(clear.knockedOut, false);
    assert.equal(clear.appearance.background, 'transparent');
  });

  test('a solid coloured plate inside transparent margins is removed; a circle emblem is a shape and kept', async () => {
    const onMargin = (svg) => sharp({ create: { width: 300, height: 140, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="140">${svg}</svg>`), top: 0, left: 0 }])
      .png().toBuffer();
    // White "lettering" with a counter: a ring whose hole shows the plate.
    const plated = await prepareLogo(await onMargin('<rect x="15" y="15" width="270" height="110" rx="12" fill="#1d4ed8"/>' +
      '<rect x="50" y="50" width="160" height="40" fill="#ffffff"/><circle cx="235" cy="70" r="18" fill="none" stroke="#ffffff" stroke-width="5"/>'));
    assert.equal(plated.knockedOut, true, 'the blue plate went');
    assert.equal(plated.appearance.background, 'transparent', 'the white lettering left over is not mistaken for a box');
    assert.equal(plated.appearance.tone, 'light');
    assert.ok(plated.width <= 210 && plated.height <= 44, `only the white lettering is left (${plated.width}×${plated.height})`);
    const counter = await pixelAt(plated.data, plated.width - 21, Math.round(plated.height / 2)); // the ring's centre
    assert.ok(counter.a < 10, `the plate colour inside the ring is gone too: ${JSON.stringify(counter)}`);
    const emblem = await prepareLogo(await onMargin('<circle cx="150" cy="70" r="60" fill="#1d4ed8"/><rect x="125" y="55" width="50" height="30" fill="#ffffff"/>'));
    assert.equal(emblem.knockedOut, false, 'a round emblem is artwork, not a plate');
  });

  test('an image that is nothing but the box is not knocked out into nothing', async () => {
    const blank = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
    assert.equal(await knockoutBackground(blank, '#ffffff'), null);
    const out = await prepareLogo(blank);
    assert.equal(out.knockedOut, false);
  });

  test('a multicolour logo gets a reversed variant: dark lettering flipped light, brand colour kept', async () => {
    const out = await prepareLogo(await boxedLogo());
    assert.equal(out.appearance.monochrome, false);
    assert.ok(out.reversed, 'a reversed variant was made');
    assert.match(out.reversed.key, /^[0-9a-f]{24}$/);
    assert.notEqual(out.reversed.key, out.key);
    const bar = await pixelAt(out.reversed.data, out.width - 20, Math.round(out.height / 2)); // the dark bar
    assert.ok(bar.r > 200 && bar.g > 200 && bar.b > 200 && bar.a > 240, `dark lettering is now light: ${JSON.stringify(bar)}`);
    const ring = await pixelAt(out.reversed.data, 3, Math.round(out.height / 2)); // the blue ring's 6px stroke
    assert.ok(ring.b > ring.r + 60, `the brand blue is untouched: ${JSON.stringify(ring)}`);
  });

  test('a single-colour mark gets no variant (CSS tints it); an all-colour mark has nothing to flip', async () => {
    const mono = await prepareLogo(await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect x="20" y="20" width="160" height="40" fill="#111827"/></svg>'), top: 0, left: 0 }])
      .png().toBuffer());
    assert.equal(mono.appearance.monochrome, true);
    assert.equal(mono.reversed, null);
    const colour = await prepareLogo(await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect x="20" y="20" width="80" height="40" fill="#dc2626"/><rect x="100" y="20" width="80" height="40" fill="#2563eb"/></svg>'), top: 0, left: 0 }])
      .png().toBuffer());
    assert.equal(colour.reversed, null);
  });

  test('a white plate inside transparent margins is removed too (the analyser sees "transparent")', async () => {
    const plated = await sharp({ create: { width: 300, height: 140, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{
        input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="140">' +
          '<rect x="20" y="20" width="260" height="100" rx="14" fill="#f9f9f9"/>' +
          '<rect x="50" y="45" width="200" height="50" fill="#101050"/></svg>'),
        top: 0, left: 0
      }]).png().toBuffer();
    const out = await prepareLogo(plated);
    assert.equal(out.original.background, 'transparent');
    assert.equal(out.knockedOut, true, 'the plate was found and removed');
    // Only the 200×50 navy bar is left: the image trims to it, not to the 260×100 plate.
    assert.ok(out.width <= 204 && out.height <= 54, `trimmed to the artwork, not the plate (${out.width}×${out.height})`);
    const ink = await pixelAt(out.data, Math.round(out.width / 2), Math.round(out.height / 2));
    assert.ok(ink.a > 240 && ink.b > ink.r, `the navy artwork is intact: ${JSON.stringify(ink)}`);
  });

  test('white artwork beside a coloured emblem on transparency is not mistaken for a plate', async () => {
    const whiteText = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{
        input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">' +
          '<circle cx="50" cy="50" r="40" fill="#dc2626"/><rect x="110" y="30" width="170" height="40" fill="#ffffff"/></svg>'),
        top: 0, left: 0
      }]).png().toBuffer();
    const out = await prepareLogo(whiteText);
    assert.equal(out.knockedOut, false);
    const text = await pixelAt(out.data, 200, 50);
    assert.ok(text.a === 255 && text.r > 240, 'the white lettering is untouched');
  });

  test('navy lettering is reversed to a pale tint of its hue for dark headers', async () => {
    const navy = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{
        input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">' +
          '<rect x="10" y="20" width="60" height="60" fill="#22c55e"/><rect x="90" y="30" width="200" height="40" fill="#101050"/></svg>'),
        top: 0, left: 0
      }]).png().toBuffer();
    const out = await prepareLogo(navy);
    assert.ok(out.reversed, 'a reversed variant exists');
    const text = await pixelAt(out.reversed.data, 190, 50);
    assert.ok(text.r > 180 && text.b > text.r, `navy became a pale blue: ${JSON.stringify(text)}`);
    const green = await pixelAt(out.reversed.data, 40, 50);
    assert.ok(green.g > 150 && green.r < 100, 'the brand green is untouched');
  });

  test('a linked SVG on a white box is rasterised and cleaned; uploads still refuse SVG', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#fff"/>' +
      '<rect x="20" y="20" width="160" height="40" fill="#0f172a"/></svg>');
    const out = await prepareLogo(svg, { linked: true });
    assert.equal(out.knockedOut, true);
    await rejects(prepareLogo(svg), 400, /PNG, JPEG or WebP/);
  });
});

test('logoAssetPath is a relative API path the widget can resolve', () => {
  assert.equal(logoAssetPath('t-1', 'abc123abc123abc123abc123'), '/api/v1/public/brand-assets/logo/t-1/abc123abc123abc123abc123.png');
});
