const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const {
  processChatImage, persistChatImage, sessionImageCount, chatImagePath,
  MAX_IMAGES_PER_SESSION, isChatImageUploadEnabled
} = require('../../src/services/shared/chatImage');

// Build a small, real image as a data URL. `exif` embeds a recognizable marker
// into the EXIF so a test can prove it is gone after processing.
async function makeImage(fmt, { exif } = {}) {
  let img = sharp({ create: { width: 48, height: 36, channels: 3, background: { r: 10, g: 20, b: 30 } } });
  if (exif) img = img.withExif({ IFD0: { ImageDescription: exif } });
  const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
  const buf = fmt === 'png' ? await img.png().toBuffer() : fmt === 'webp' ? await img.webp().toBuffer() : await img.jpeg().toBuffer();
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, buf, mime };
}

describe('chatImagePath + constants', () => {
  test('builds the scoped public path with the extension for the type', () => {
    assert.equal(chatImagePath('t1', 'abc123', 'image/png'), '/api/v1/public/chat-images/t1/abc123.png');
    assert.equal(chatImagePath('t1', 'abc123', 'image/jpeg'), '/api/v1/public/chat-images/t1/abc123.jpg');
    assert.equal(chatImagePath('t1', 'abc123', 'image/webp'), '/api/v1/public/chat-images/t1/abc123.webp');
  });

  test('the per-chat image cap defaults to 3', () => {
    assert.equal(MAX_IMAGES_PER_SESSION, 3);
  });
});

describe('processChatImage — re-encode and strip metadata', { skip: !sharp && 'sharp not installed' }, () => {
  test('removes EXIF/location metadata from a photo that carried it', async () => {
    const { dataUrl, buf } = await makeImage('jpeg', { exif: 'EXIFMARKER123' });
    assert.ok(buf.includes(Buffer.from('EXIFMARKER123')), 'the source really does carry the marker in its metadata');

    const out = await processChatImage(dataUrl, { sharp });
    assert.ok(out, 'a valid image is processed');
    assert.ok(!out.data.includes(Buffer.from('EXIFMARKER123')), 'the processed bytes must not carry the EXIF marker');
    const meta = await sharp(out.data).metadata();
    assert.ok(!meta.exif, 'and sharp sees no EXIF block at all');
  });

  test('keeps the image format', async () => {
    for (const fmt of ['png', 'jpeg', 'webp']) {
      const { dataUrl } = await makeImage(fmt);
      const out = await processChatImage(dataUrl, { sharp });
      assert.equal(out.mimeType, fmt === 'jpeg' ? 'image/jpeg' : `image/${fmt}`, `${fmt} stays ${fmt}`);
      assert.ok(out.width > 0 && out.height > 0 && out.bytes === out.data.length);
    }
  });

  test('is content-addressed: the same image yields the same key, a different one a different key', async () => {
    const a = await makeImage('png');
    const b = await makeImage('png');       // identical pixels → identical bytes → same key
    const c = await sharp({ create: { width: 48, height: 36, channels: 3, background: { r: 200, g: 0, b: 0 } } }).png().toBuffer();
    const cUrl = `data:image/png;base64,${c.toString('base64')}`;
    const ka = (await processChatImage(a.dataUrl, { sharp })).key;
    const kb = (await processChatImage(b.dataUrl, { sharp })).key;
    const kc = (await processChatImage(cUrl, { sharp })).key;
    assert.equal(ka, kb);
    assert.notEqual(ka, kc);
    assert.match(ka, /^[0-9a-f]{32}$/, 'a 128-bit hex key');
  });

  test('a malformed data URL yields null, not a throw', async () => {
    assert.equal(await processChatImage('not-a-data-url', { sharp }), null);
    assert.equal(await processChatImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', { sharp }), null);
  });

  test('without sharp, processing is unavailable (null) rather than an error', async () => {
    assert.equal(isChatImageUploadEnabled() || !sharp, true);
    const { dataUrl } = await makeImage('png');
    assert.equal(await processChatImage(dataUrl, { sharp: null }), null);
  });
});

describe('persistChatImage — content-addressed upsert, best-effort', { skip: !sharp && 'sharp not installed' }, () => {
  test('stores the processed image once and returns its key', async () => {
    const { dataUrl } = await makeImage('jpeg');
    const upserts = [];
    const prisma = { chatImageAsset: { upsert: async (args) => { upserts.push(args); return {}; } } };
    const key = await persistChatImage({ tenantId: 't1', dataUrl, prisma, sharp });
    assert.match(key, /^[0-9a-f]{32}$/);
    assert.equal(upserts.length, 1);
    assert.deepEqual(upserts[0].where, { tenantId_key: { tenantId: 't1', key } });
    assert.equal(upserts[0].create.tenantId, 't1');
    assert.equal(upserts[0].create.key, key);
    assert.ok(Buffer.isBuffer(upserts[0].create.data));
  });

  test('a storage failure returns null instead of breaking the turn', async () => {
    const { dataUrl } = await makeImage('png');
    const prisma = { chatImageAsset: { upsert: async () => { throw new Error('db down'); } } };
    assert.equal(await persistChatImage({ tenantId: 't1', dataUrl, prisma, sharp }), null);
  });
});

describe('sessionImageCount — for the per-chat cap', () => {
  test('counts the user messages that carry images', async () => {
    const prisma = { chatMessage: { count: async ({ where }) => { assert.deepEqual(where.imageKeys, { isEmpty: false }); return 2; } } };
    assert.equal(await sessionImageCount({ sessionId: 's1', prisma }), 2);
  });

  test('fails open to 0 so a count error never blocks an upload', async () => {
    const prisma = { chatMessage: { count: async () => { throw new Error('boom'); } } };
    assert.equal(await sessionImageCount({ sessionId: 's1', prisma }), 0);
  });
});
