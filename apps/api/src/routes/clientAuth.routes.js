const express = require('express');
const prisma = require('../lib/prisma');
const { verifyPassword } = require('../utils/password');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { requireClient, signClientToken, TENANT_FIELDS } = require('../middleware/clientAuth');

// Client dashboard sign-in (apps/web/pages/login.js). Accounts are created
// by the signup wizard; there is no other way to get one.
const router = express.Router();

const isLoginRateLimited = createIpRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

router.post('/login', async (req, res) => {
  if (isLoginRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = await prisma.tenantUser.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true, tenant: { select: TENANT_FIELDS } }
  });
  // Same message for an unknown email and a wrong password.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.tenant.active) {
    return res.status(403).json({ error: 'This account has been deactivated. Contact KGT support.' });
  }
  await prisma.tenantUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  res.json({
    token: signClientToken(user),
    user: { id: user.id, email: user.email, name: user.name },
    tenant: user.tenant
  });
});

router.get('/me', requireClient, (req, res) => {
  res.json({ user: req.tenantUser, tenant: req.tenant });
});

module.exports = router;
