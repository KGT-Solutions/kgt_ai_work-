const express = require('express');
const prisma = require('../lib/prisma');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { EXT_MIME, KEY_LEN } = require('../services/shared/chatImage');

// Scoped serving of visitor-uploaded chat images (model ChatImageAsset). Like
// the brand-asset route, the URL is content-addressed — a sha256 prefix that
// only exists while that image is stored — so staff <img> tags in Chat Logs and
// links in a team's lead-alert email resolve without a session cookie or the
// widget's API key, neither of which an <img> or an email client can send. The
// key is 128-bit, so it is not enumerable; still rate-limited and scoped to its
// tenant. These are visitor images, so they are NOT cached at shared proxies
// (private) the way public logos are.

const router = express.Router();

const isImageRateLimited = createIpRateLimiter({
  name: 'chat-image',
  max: Number(process.env.CHAT_IMAGE_RATE_LIMIT_MAX) || 300,
  windowMs: 60 * 1000
});

// The extension is cosmetic — the real content type comes from the stored row —
// so it is optional, letting a caller link an image by key alone.
const KEY_RE = new RegExp(`^([0-9a-f]{${KEY_LEN}})(?:\\.(jpg|jpeg|png|webp))?$`);
const MIME_FILE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const notFound = (res) => res.status(404).json({ error: 'Not found' });

router.get('/:tenantId/:file', async (req, res) => {
  if (await isImageRateLimited(req.ip)) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests' });
  }
  const match = KEY_RE.exec(req.params.file);
  if (!match) return notFound(res);
  const [, key, ext] = match;

  const asset = await prisma.chatImageAsset.findUnique({
    where: { tenantId_key: { tenantId: req.params.tenantId, key } },
    select: { data: true, mimeType: true }
  });
  if (!asset) return notFound(res);

  const fileExt = MIME_FILE_EXT[asset.mimeType] || ext || 'jpg';
  res.set({
    'Content-Type': asset.mimeType || EXT_MIME[ext] || 'application/octet-stream',
    'Content-Length': String(asset.data.length),
    // Content at a content-addressed URL never changes, so it caches — but these
    // are visitor images: private (per-viewer), never shared-proxy cached.
    'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': `inline; filename="image.${fileExt}"`
  });
  res.end(asset.data);
});

module.exports = router;
