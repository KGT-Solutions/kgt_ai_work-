const express = require('express');
const prisma = require('../lib/prisma');
const { findValidApiKey, shouldTouchLastUsed } = require('../utils/tenantApiKeys');
const { handleChat } = require('../services/tenantChat');

// Public chat endpoint used by the embed widget and customers' own apps:
//   POST /api/v1/tenant-chat/:slug/chat   header X-Tenant-Api-Key: tk_...
// The slug picks the tenant; the key must be a live (non-revoked) key of
// THAT tenant, matched by SHA-256 hash — a key of another tenant is
// rejected exactly like an unknown one. Everything after this point
// (services/tenantChat.js) only ever sees req.tenant.
const router = express.Router();

router.use('/:slug', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug: req.params.slug } });
    if (!tenant || !tenant.active) return res.status(404).json({ error: 'Unknown tenant' });

    const key = await findValidApiKey(prisma, tenant.id, req.headers['x-tenant-api-key']);
    if (!key) return res.status(401).json({ error: 'Missing or invalid X-Tenant-Api-Key' });
    if (shouldTouchLastUsed(key)) {
      // Best-effort bookkeeping — never fail or delay a chat request over it.
      prisma.tenantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
});

router.post('/:slug/chat', handleChat);

module.exports = router;
