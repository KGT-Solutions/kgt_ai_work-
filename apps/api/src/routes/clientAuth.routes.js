const express = require('express');
const prisma = require('../lib/prisma');
const { verifyPassword } = require('../utils/password');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { maskAddress } = require('../services/mailer');
const { requireClient, signClientToken, TENANT_FIELDS } = require('../middleware/clientAuth');

// Client dashboard sign-in (apps/web/pages/login.js). Accounts are created by
// the signup wizard; there is no other way to get one. Forgot password lives
// with the other public email-code flows: routes/publicAuth.routes.js
// (/forgot-password, /reset-password) and services/passwordResetService.js.
const router = express.Router();

const isLoginRateLimited = createIpRateLimiter({ name: 'client-login', max: 10, windowMs: 15 * 60 * 1000 });

router.post('/login', async (req, res) => {
  if (await isLoginRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = await prisma.tenantUser.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true, tenant: { select: TENANT_FIELDS } }
  });
  // Same message to the visitor for an unknown email and a wrong password (no
  // account discovery), but the server log says which — "Invalid email or
  // password" is otherwise impossible to diagnose.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    // KGT staff signing in on the company page: point them to the staff
    // console. Only said when the staff email AND password are right, so it
    // reveals nothing to someone guessing.
    if (!user) {
      const operator = await prisma.operator.findUnique({ where: { email }, select: { passwordHash: true } });
      if (operator && verifyPassword(password, operator.passwordHash)) {
        console.warn(`[auth] client sign-in refused for ${maskAddress(email)}: staff account — sent to the staff console`);
        return res.status(401).json({
          error: 'This is a KGT staff account. Sign in on the staff console instead.', code: 'STAFF_ACCOUNT', signInPath: '/admin/login'
        });
      }
    }
    console.warn(`[auth] client sign-in refused for ${maskAddress(email)}: ${user ? 'wrong password' : 'no account with this email'}`);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.tenant.active) {
    console.warn(`[auth] client sign-in refused for ${maskAddress(email)}: company deactivated`);
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
