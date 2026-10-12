const crypto = require('crypto');
const prisma = require('../lib/prisma');
const mailer = require('./mailer');
const { hashPassword } = require('../utils/password');

// Forgot password for client accounts (apps/web/pages/forgot-password.js):
//   1. requestPasswordReset(email)                 a 6-digit code to the account's email
//   2. resetPassword(email, otp, newPassword)      code + new password in one step
//
// An unknown email is told so immediately ("No account found…"): the signup
// wizard already reveals whether an address has an account, so hiding it
// here protected nothing and left people waiting for a code that never came.
// The per-IP and per-address rate limits in routes/publicAuth.routes.js bound
// how fast anyone can probe.
//
// Codes (PasswordResetCode): only an HMAC bound to the account is stored;
// 10-minute expiry; a new code voids the previous one; 60s between sends;
// every guess claims one of 5 attempts atomically BEFORE it's compared (so
// parallel guesses can't exceed the limit); single use. A successful reset
// sets passwordChangedAt, which signs the account out of every older session
// (middleware/clientAuth.js).

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MIN_PASSWORD_LEN = 10; // mirrors signup
const NO_ACCOUNT = 'No account found with this email address.';

class PasswordResetError extends Error {
  constructor(statusCode, message, extra = {}) {
    super(message);
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** @returns {{ subject: string, text: string, html: string }} */
function resetEmail(code) {
  const minutes = CODE_TTL_MS / 60000;
  const notice = `This code is valid for ${minutes} minutes and can only be used once. Never share it with anyone — KGT will never ask ` +
    'you for it. If you didn\'t ask to reset your password, you can ignore this email: your password stays the same.';
  const text = `Your KGT AI Hub password reset code is ${code}\n\nEnter it on the reset page together with your new password.\n\n${notice}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fa;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fa;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;">
<tr><td style="padding:22px 32px;border-bottom:1px solid #e2e8f0;font-size:16px;font-weight:700;color:#0f172a;">KGT AI Hub</td></tr>
<tr><td style="padding:28px 32px 8px;">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Reset your password</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">Use this code on the reset page, together with your new password:</p>
<p style="margin:0 0 20px;padding:16px 0;background:#f1f5f9;border-radius:10px;text-align:center;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0f172a;">${escapeHtml(code)}</p>
<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#b45309;">Valid for ${minutes} minutes</p>
</td></tr>
<tr><td style="padding:12px 32px 26px;font-size:12.5px;line-height:1.6;color:#64748b;">${escapeHtml(notice)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `${code} is your KGT AI Hub password reset code`, text, html };
}

/**
 * Emails a reset code to the account, voiding any earlier unused one.
 * @returns {Promise<{ ok: true, email: string, expiresInSeconds: number, resendInSeconds: number }>}
 * @throws {PasswordResetError} 400 bad email, 404 no account, 403 deactivated, 429 too soon, 502 mail not sent
 */
async function requestPasswordReset(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new PasswordResetError(400, 'Enter the email address you signed up with.');

  const user = await prisma.tenantUser.findUnique({
    where: { email },
    select: { id: true, email: true, tenant: { select: { active: true } } }
  });
  if (!user) throw new PasswordResetError(404, NO_ACCOUNT, { code: 'EMAIL_NOT_FOUND' });
  if (!user.tenant.active) throw new PasswordResetError(403, 'This account has been deactivated. Contact KGT support.');

  const latest = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true }
  });
  const wait = latest ? latest.createdAt.getTime() + RESEND_COOLDOWN_MS - Date.now() : 0;
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    throw new PasswordResetError(429, `Please wait ${seconds}s before requesting another code.`, { retryAfter: seconds });
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  const [, created] = await prisma.$transaction([
    // A new code voids any earlier unused one.
    prisma.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    prisma.passwordResetCode.create({
      data: { userId: user.id, codeHash: hashCode(user.id, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS) }
    })
  ]);

  const result = await mailer.sendMail({
    to: user.email, ...resetEmail(code), label: 'password reset code',
    devSummary: `reset code ${code} (expires in ${CODE_TTL_MS / 60000} min)` // dev log only; never printed in production
  });
  if (!result.sent) {
    // The code never arrived: void it, so it neither works nor blocks an immediate retry.
    await prisma.passwordResetCode.updateMany({ where: { id: created.id }, data: { usedAt: new Date() } }).catch(() => {});
    throw new PasswordResetError(502, 'We couldn\'t send the reset email just now. Please try again in a minute.');
  }
  return { ok: true, email, expiresInSeconds: CODE_TTL_MS / 1000, resendInSeconds: RESEND_COOLDOWN_MS / 1000 };
}

/**
 * Checks the code and, if it's right, sets the new password — all or nothing.
 * @returns {Promise<{ ok: true }>}
 * @throws {PasswordResetError} 400 bad input / wrong or expired code, 429 too many wrong codes
 */
async function resetPassword(rawEmail, rawOtp, newPassword) {
  const email = normalizeEmail(rawEmail);
  const otp = String(rawOtp || '').trim();
  const password = String(newPassword || '');
  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) throw new PasswordResetError(400, 'Enter the 6-digit code from the email.');
  // Checked before the code, so a too-short password doesn't use up an attempt.
  if (password.length < MIN_PASSWORD_LEN) {
    throw new PasswordResetError(400, `Choose a password of at least ${MIN_PASSWORD_LEN} characters.`, { field: 'newPassword' });
  }

  const INVALID = 'That code is invalid or has expired. Request a new one.';
  const user = await prisma.tenantUser.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new PasswordResetError(400, INVALID);
  const pending = await prisma.passwordResetCode.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!pending) throw new PasswordResetError(400, INVALID);

  // Claim one attempt BEFORE comparing, in a single conditional update:
  // reading the count and incrementing afterwards would let parallel guesses
  // all see the same count and all be checked.
  const { count: claimed } = await prisma.passwordResetCode.updateMany({
    where: { id: pending.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } }
  });
  if (!claimed) throw new PasswordResetError(429, 'Too many wrong codes. Request a new code.');
  if (!sameHash(pending.codeHash, hashCode(user.id, otp))) {
    const left = Math.max(0, MAX_ATTEMPTS - (pending.attempts + 1));
    throw left > 0
      ? new PasswordResetError(400, `That code isn't right. ${left} attempt${left === 1 ? '' : 's'} left.`, { attemptsLeft: left })
      : new PasswordResetError(429, 'Too many wrong codes. Request a new code.', { attemptsLeft: 0 });
  }

  const now = new Date();
  const done = await prisma.$transaction(async (tx) => {
    // Single use: only an unused code is consumed, once — a second request
    // racing with the same code finds nothing to consume.
    const { count } = await tx.passwordResetCode.updateMany({ where: { id: pending.id, usedAt: null }, data: { usedAt: now } });
    if (!count) return false;
    await tx.tenantUser.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password), passwordChangedAt: now } });
    return true;
  });
  if (!done) throw new PasswordResetError(400, INVALID);
  return { ok: true };
}

module.exports = {
  requestPasswordReset, resetPassword, resetEmail, PasswordResetError,
  NO_ACCOUNT, CODE_TTL_MS, RESEND_COOLDOWN_MS, MAX_ATTEMPTS, MIN_PASSWORD_LEN
};
