const crypto = require('crypto');
const express = require('express');
const prisma = require('../lib/prisma');
const { hashPassword, verifyPassword } = require('../utils/password');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { signToken, verifyToken } = require('../utils/authTokens');
const { sendMail } = require('../services/mailer');
const { requireClient, signClientToken, TENANT_FIELDS } = require('../middleware/clientAuth');

// Client dashboard sign-in and password reset (apps/web/pages/login.js,
// forgot-password.js). Accounts are created by the signup wizard; there is
// no other way to get one.
const router = express.Router();

const MIN_PASSWORD_LEN = 10;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const isLoginRateLimited = createIpRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const isForgotIpLimited = createIpRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const isForgotEmailLimited = createIpRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
const isVerifyIpLimited = createIpRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

// The code is stored as an HMAC bound to the account, never in plaintext.
function hashCode(userId, code) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const FORGOT_REPLY = {
  ok: true,
  message: 'If an account exists for that email, a 6-digit code is on its way. It expires in 10 minutes.'
};

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

// ── Forgot password: request code → verify code → set new password.

// 1. Request a code. Always the same reply, whether or not the email has an
//    account, so this can't be used to discover who's a customer.
router.post('/password/forgot', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (isForgotIpLimited(req.ip) || (email && isForgotEmailLimited(email))) {
    return res.status(429).json({ error: 'Too many code requests. Please wait a few minutes and try again.' });
  }
  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await prisma.tenantUser.findUnique({
    where: { email },
    select: { id: true, email: true, tenant: { select: { active: true, name: true } } }
  });
  if (!user || !user.tenant.active) return res.json(FORGOT_REPLY);

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.$transaction([
    // A new code voids any earlier unused one.
    prisma.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetCode.create({
      data: { userId: user.id, codeHash: hashCode(user.id, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) }
    })
  ]);

  await sendMail({
    to: user.email,
    subject: `${code} is your KGT AI Hub verification code`,
    text:
      `Your KGT AI Hub password reset code is ${code}.\n\n` +
      'It expires in 10 minutes. If you didn\'t ask to reset your password, you can ignore this email — ' +
      'your password stays the same.',
    devSummary: `reset code ${code} (expires in 10 min)`
  });
  res.json(FORGOT_REPLY);
});

// 2. Check the code. Success returns a short-lived reset token for step 3.
router.post('/password/verify', async (req, res) => {
  if (isVerifyIpLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from the email.' });

  const INVALID = { error: 'That code is invalid or has expired. Request a new one.' };
  const user = await prisma.tenantUser.findUnique({ where: { email }, select: { id: true } });
  if (!user) return res.status(400).json(INVALID);
  const pending = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!pending) return res.status(400).json(INVALID);
  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many wrong codes. Request a new code.' });
  }
  if (!sameHash(pending.codeHash, hashCode(user.id, code))) {
    const { attempts } = await prisma.passwordResetCode.update({
      where: { id: pending.id }, data: { attempts: { increment: 1 } }, select: { attempts: true }
    });
    const left = MAX_CODE_ATTEMPTS - attempts;
    return res.status(400).json({
      error: left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong codes. Request a new code.'
    });
  }
  res.json({ resetToken: signToken('reset', { tenantUserId: user.id, resetCodeId: pending.id }) });
});

// 3. Set the new password. Consumes the code and signs the account out of
//    every existing session (passwordChangedAt, checked in clientAuth.js).
router.post('/password/reset', async (req, res) => {
  const claims = verifyToken(String(req.body?.resetToken || ''), 'reset');
  if (!claims?.tenantUserId || !claims.resetCodeId) {
    return res.status(400).json({ error: 'This reset link has expired. Start again.' });
  }
  const password = String(req.body?.password || '');
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Choose a password of at least ${MIN_PASSWORD_LEN} characters.` });
  }

  const now = new Date();
  const done = await prisma.$transaction(async (tx) => {
    // Single use: only an unused code of this user can be consumed, once.
    const { count } = await tx.passwordResetCode.updateMany({
      where: { id: claims.resetCodeId, userId: claims.tenantUserId, usedAt: null },
      data: { usedAt: now }
    });
    if (!count) return false;
    await tx.tenantUser.update({
      where: { id: claims.tenantUserId },
      data: { passwordHash: hashPassword(password), passwordChangedAt: now }
    });
    return true;
  });
  if (!done) return res.status(400).json({ error: 'This reset link has already been used or has expired. Start again.' });
  res.json({ ok: true });
});

module.exports = router;
