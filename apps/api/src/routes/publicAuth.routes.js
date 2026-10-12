const express = require('express');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { sendSignupOtp, verifySignupOtp, VerificationError } = require('../services/verificationService');
const { requestPasswordReset, resetPassword, PasswordResetError } = require('../services/passwordResetService');
const { maskAddress } = require('../services/mailer');

// Signup email verification for the public wizard (apps/web/pages/register.js),
// before an account exists — so no login, and everything is rate-limited.
//   POST /api/v1/public/auth/send-otp    { email }        -> emails a 6-digit code
//   POST /api/v1/public/auth/verify-otp  { email, otp }   -> { verified, verificationToken }
// The token goes to /api/v1/public/register/complete, which refuses (403)
// to create an account without it. Logic: services/verificationService.js.
const router = express.Router();

// Sending is an outbound email from our own address: per IP, and per
// recipient on top of the 60s resend cooldown, so the form can't be used to
// flood someone's inbox.
const isSendIpLimited = createIpRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const isSendEmailLimited = createIpRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
// Guessing is also capped per code (5 attempts); this bounds it per IP across codes.
const isVerifyIpLimited = createIpRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

const TOO_MANY = { error: 'Too many requests. Please wait a few minutes and try again.' };

function sendError(res, err) {
  if (!(err instanceof VerificationError || err instanceof PasswordResetError)) throw err;
  if (err.extra.retryAfter) res.set('Retry-After', String(err.extra.retryAfter));
  return res.status(err.statusCode).json({ error: err.message, ...err.extra });
}

router.post('/send-otp', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (isSendIpLimited(req.ip) || (email && isSendEmailLimited(email))) return res.status(429).json(TOO_MANY);
  try {
    res.json(await sendSignupOtp(email));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/verify-otp', async (req, res) => {
  if (isVerifyIpLimited(req.ip)) return res.status(429).json(TOO_MANY);
  try {
    res.json(await verifySignupOtp(req.body?.email, req.body?.otp));
  } catch (err) {
    sendError(res, err);
  }
});

// ── Forgot password (services/passwordResetService.js)
//   POST /forgot-password  { email }                       -> emails a 6-digit code; 404 if no account
//   POST /reset-password   { email, otp, newPassword }     -> sets the new password
const isForgotIpLimited = createIpRateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
const isForgotEmailLimited = createIpRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
const isResetIpLimited = createIpRateLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (isForgotIpLimited(req.ip) || (email && isForgotEmailLimited(email))) return res.status(429).json(TOO_MANY);
  try {
    res.json(await requestPasswordReset(email));
  } catch (err) {
    if (err instanceof PasswordResetError) console.warn(`[auth] password reset refused for ${maskAddress(email)}: ${err.extra.code || err.message}`);
    sendError(res, err);
  }
});

router.post('/reset-password', async (req, res) => {
  if (isResetIpLimited(req.ip)) return res.status(429).json(TOO_MANY);
  const email = String(req.body?.email || '').trim().toLowerCase();
  try {
    res.json(await resetPassword(email, req.body?.otp, req.body?.newPassword));
    console.log(`[auth] password reset for ${maskAddress(email)}`);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
