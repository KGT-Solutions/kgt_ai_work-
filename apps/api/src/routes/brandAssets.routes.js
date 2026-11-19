const express = require('express');
const { getLogoAsset, resolveLogoKey } = require('../services/branding');
const { createIpRateLimiter } = require('../utils/ipRateLimit');

// Public brand assets: a tenant's hosted logo, as the server re-encoded it
// (services/shared/logoUpload.js). Unauthenticated on purpose — an <img> on a
// customer's website can't send the widget's API key — so the URL carries the
// content key instead: a 24-hex sha256 prefix that only exists while that
// image is the tenant's current logo. Content at a URL never changes, so
// browsers cache it for a year.
//
// Hardening (adversarial review):
//   - a key is resolved without reading image bytes (branding.resolveLogoKey),
//     then exactly one binary column is read — a guessed key costs the
//     database a few short columns, not megabytes;
//   - per-IP rate limit (a visitor loads a logo once; browsers cache it);
//   - the in-memory cache is bounded by BYTES (LRU), not by entry count — 500
//     entries of a 1 MB noise logo was ~500 MB per replica;
//   - a cached entry is re-validated (keys only, no bytes) after
//     REVALIDATE_MS, so a replaced or removed logo stops being served within
//     that time instead of living in the cache forever.

const router = express.Router();

const CACHE_MAX_BYTES = Number(process.env.BRAND_ASSET_CACHE_MAX_BYTES) || 32 * 1024 * 1024;
const REVALIDATE_MS = 30 * 1000;
const isAssetRateLimited = createIpRateLimiter({
  name: 'brand-asset',
  max: Number(process.env.BRAND_ASSET_RATE_LIMIT_MAX) || 300,
  windowMs: 60 * 1000
});

// Insertion-ordered Map as an LRU: a hit re-inserts the entry at the end.
const cache = new Map(); // `${tenantId}/${key}` -> { data, mimeType, checkedAt }
let cachedBytes = 0;

function evict(id) {
  const entry = cache.get(id);
  if (!entry) return;
  cachedBytes -= entry.data.length;
  cache.delete(id);
}

function remember(id, entry) {
  evict(id);
  if (entry.data.length > CACHE_MAX_BYTES) return; // never let one entry flush the cache
  while (cachedBytes + entry.data.length > CACHE_MAX_BYTES && cache.size) evict(cache.keys().next().value);
  cache.set(id, entry);
  cachedBytes += entry.data.length;
}

function sendLogo(res, asset) {
  res.set({
    'Content-Type': 'image/png',
    'Content-Length': String(asset.data.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // Embedded by the widget on customers' sites, so cross-origin by design —
    // and never a document that could run anything.
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline; filename="logo.png"'
  });
  res.end(asset.data);
}

const notFound = (res) => res.status(404).json({ error: 'Not found' });

router.get('/logo/:tenantId/:file', async (req, res) => {
  if (await isAssetRateLimited(req.ip)) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests' });
  }
  const match = /^([0-9a-f]{24})\.png$/.exec(req.params.file);
  if (!match) return notFound(res);
  const { tenantId } = req.params;
  const key = match[1];
  const id = `${tenantId}/${key}`;

  const hit = cache.get(id);
  if (hit) {
    if (Date.now() - hit.checkedAt < REVALIDATE_MS) {
      cache.delete(id); cache.set(id, hit); // most recently used
      return sendLogo(res, hit);
    }
    // Stale check: is this still a live image? Keys only — no bytes read.
    if (await resolveLogoKey(tenantId, key)) {
      hit.checkedAt = Date.now();
      cache.delete(id); cache.set(id, hit);
      return sendLogo(res, hit);
    }
    evict(id);
    return notFound(res);
  }

  const asset = await getLogoAsset(tenantId, key);
  if (!asset) return notFound(res);
  const entry = { data: Buffer.from(asset.data), mimeType: asset.mimeType, checkedAt: Date.now() };
  remember(id, entry);
  return sendLogo(res, entry);
});

/** Empty the in-memory logo cache (tests). */
router.clearCache = () => { cache.clear(); cachedBytes = 0; };
/** Cache size, for tests and diagnostics. */
router.cacheStats = () => ({ entries: cache.size, bytes: cachedBytes, maxBytes: CACHE_MAX_BYTES });

module.exports = router;
