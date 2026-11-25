const crypto = require('crypto');
const { logger } = require('../../lib/logger');
const defaultPrisma = require('../../lib/prisma');
const { parseImageDataUrl } = require('./imageGuardrail');

let sharpLib = null;
try { sharpLib = require('sharp'); } catch { sharpLib = null; }

// Persistence for visitor-uploaded chat images. A valid upload (JPG/PNG/WebP,
// ≤5 MB — enforced by parseImageDataUrl) is decoded and RE-ENCODED through
// sharp, which drops every metadata block (EXIF, GPS, orientation is baked in
// by .rotate() first). The processed bytes are content-hashed and stored once
// per tenant, so the same photo sent twice is a single row. The scoped route
// (routes/chatImages.routes.js) serves them back by that key.
//
// Guardrails/limits: at most MAX_IMAGES_PER_SESSION stored per conversation;
// sandbox (dashboard test) chats persist nothing. Everything here is
// best-effort from the caller's view — a failure returns null and the turn is
// still answered, just without a stored image.

const MAX_INPUT_PIXELS = 50 * 1000 * 1000; // a 5 MB file can still claim huge dimensions; refuse to decode those
const MAX_IMAGES_PER_SESSION = Number(process.env.CHAT_MAX_IMAGES_PER_SESSION || 3);
const KEY_LEN = 32; // hex chars of the sha256 → 128-bit, unguessable in a public link

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function isChatImageUploadEnabled() {
  return !!sharpLib;
}

/** The public path the scoped route serves this asset at (no host; the caller prefixes one). */
function chatImagePath(tenantId, key, mimeType) {
  return `/api/v1/public/chat-images/${tenantId}/${key}.${MIME_EXT[mimeType] || 'jpg'}`;
}

/**
 * Re-encode a data-URL image, stripping all metadata, keeping its format.
 * @returns {Promise<{ data: Buffer, key: string, mimeType: string, width: number, height: number, bytes: number } | null>}
 *   null when uploads aren't available (no sharp) or the image can't be decoded.
 */
async function processChatImage(dataUrl, { sharp = sharpLib } = {}) {
  if (!sharp) return null;
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed.ok) return null; // shape/size already validated upstream; defensive
  const buffer = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');

  const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
    .rotate(); // bake EXIF orientation in, THEN drop metadata (no .withMetadata())

  let out;
  if (parsed.mimeType === 'image/png') out = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  else if (parsed.mimeType === 'image/webp') out = await pipeline.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  else out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });

  const data = out.data;
  const key = crypto.createHash('sha256').update(data).digest('hex').slice(0, KEY_LEN);
  return {
    data, key, mimeType: parsed.mimeType,
    width: out.info.width, height: out.info.height, bytes: data.length
  };
}

/**
 * Process and store one chat image for a tenant, returning its content key.
 * Content-addressed upsert, so re-sending the same photo doesn't duplicate the
 * bytes. Never throws — a failure returns null and the turn is answered anyway.
 * @returns {Promise<string|null>} the stored key, or null
 */
async function persistChatImage({ tenantId, dataUrl, prisma = defaultPrisma, sharp = sharpLib }) {
  try {
    const processed = await processChatImage(dataUrl, { sharp });
    if (!processed) return null;
    const { data, key, mimeType, width, height, bytes } = processed;
    await prisma.chatImageAsset.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, data, mimeType, width, height, bytes },
      update: {} // identical bytes → nothing to change
    });
    return key;
  } catch (err) {
    logger.warn(`[chatImage] could not store image for tenant ${tenantId}: ${err.message}`);
    return null;
  }
}

/** How many images this conversation has already stored (for the per-chat cap). */
async function sessionImageCount({ sessionId, prisma = defaultPrisma }) {
  try {
    return await prisma.chatMessage.count({ where: { sessionId, imageKeys: { isEmpty: false } } });
  } catch {
    return 0; // fail open: never block an upload because the count read failed
  }
}

module.exports = {
  isChatImageUploadEnabled, processChatImage, persistChatImage, sessionImageCount,
  chatImagePath, MAX_IMAGES_PER_SESSION, MIME_EXT, EXT_MIME, KEY_LEN
};
