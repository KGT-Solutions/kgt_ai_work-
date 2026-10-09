const crypto = require('crypto');
const prisma = require('../lib/prisma');
const mailer = require('./mailer');
const { signToken, verifyToken } = require('../utils/authTokens');

// Signup email verification: before the signup wizard may create an account
// (POST /register/complete), the address must prove it's reachable by the
// person signing up, with a 6-digit code emailed from our sender
// (SMTP_FROM, connect@kgt.solutions).
//
//   1. sendSignupOtp(email)          a fresh code replaces any earlier one
//   2. verifySignupOtp(email, code)  -> a "signup" token (2h) naming that row
//   3. claimVerification(tx, ...)    /complete checks the token against the
//                                    row and consumes it, inside its transaction
//
// Same safeguards as the password-reset code (routes/clientAuth.routes.js):
// only an HMAC of the code is stored, it expires after 10 minutes, every
// guess claims an attempt atomically BEFORE it's compared (so parallel
// guesses can't exceed the limit), 5 wrong guesses lock it, and a verified
// address works for one account creation only.

const CODE_TTL_MS = 10 * 60 * 1000;
const VERIFIED_TTL_MS = 2 * 60 * 60 * 1000; // matches the signup token's TTL
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

class VerificationError extends Error {
  constructor(statusCode, message, extra = {}) {
    super(message);
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

// Bound to the address, so a code can't be replayed for another one.
function hashCode(email, code) {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', secret).update(`signup:${email}:${code}`).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** @returns {{ subject: string, text: string, html: string }} */
function otpEmail(code) {
  const minutes = CODE_TTL_MS / 60000;
  const notice = `This code is valid for ${minutes} minutes and can only be used once. Never share it with anyone — ` +
    'KGT will never ask you for it. If you didn\'t start creating an account, you can safely ignore this email.';
  const text = `Your KGT AI Hub verification code is ${code}\n\nEnter it in the signup page to verify your email address.\n\n${notice}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fa;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fa;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;">
<tr><td style="padding:22px 32px;border-bottom:1px solid #e2e8f0;font-size:16px;font-weight:700;color:#0f172a;">KGT AI Hub</td></tr>
<tr><td style="padding:28px 32px 8px;">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#0f172a;">Verify your email address</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">Enter this code in the signup page to continue creating your AI bots:</p>
<p style="margin:0 0 20px;padding:16px 0;background:#f1f5f9;border-radius:10px;text-align:center;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0f172a;">${escapeHtml(code)}</p>
<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#b45309;">Valid for ${minutes} minutes</p>
</td></tr>
<tr><td style="padding:12px 32px 26px;font-size:12.5px;line-height:1.6;color:#64748b;">${escapeHtml(notice)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `${code} is your KGT AI Hub verification code`, text, html };
}

/**
 * Emails a new code to the address, replacing any earlier one.
 * @returns {Promise<{ ok: true, email: string, expiresInSeconds: number, resendInSeconds: number }>}
 * @throws {VerificationError} 400 bad email, 409 account exists, 429 too soon, 502 mail not sent
 */
async function sendSignupOtp(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new VerificationError(400, 'Enter a valid email address.');
  if (await prisma.tenantUser.findUnique({ where: { email }, select: { id: true } })) {
    throw new VerificationError(409, 'An account with this email already exists — sign in instead.');
  }

  const existing = await prisma.emailVerification.findUnique({ where: { email }, select: { lastSentAt: true } });
  const wait = existing ? existing.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now() : 0;
  if (wait > 0) {
    const seconds = Math.ceil(wait / 1000);
    throw new VerificationError(429, `Please wait ${seconds}s before requesting another code.`, { retryAfter: seconds });
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  const fresh = {
    codeHash: hashCode(email, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), attempts: 0,
    verified: false, verifiedAt: null, usedAt: null, lastSentAt: now
  };
  await prisma.emailVerification.upsert({ where: { email }, create: { email, ...fresh }, update: fresh });

  const result = await mailer.sendMail({
    to: email, ...otpEmail(code), label: 'signup verification code',
    devSummary: `signup code ${code} (expires in ${CODE_TTL_MS / 60000} min)` // dev log only; never printed in production
  });
  if (!result.sent) {
    // Let them retry straight away: the code they never received mustn't block a resend.
    await prisma.emailVerification.update({ where: { email }, data: { lastSentAt: new Date(0) } }).catch(() => {});
    throw new VerificationError(502, 'We couldn\'t send the verification email just now. Please try again in a minute.');
  }
  return { ok: true, email, expiresInSeconds: CODE_TTL_MS / 1000, resendInSeconds: RESEND_COOLDOWN_MS / 1000 };
}

/**
 * Checks a code. Success marks the address verified and returns the token
 * /register/complete needs.
 * @returns {Promise<{ verified: true, email: string, verificationToken: string }>}
 * @throws {VerificationError} 400 wrong / expired code, 429 too many wrong codes
 */
async function verifySignupOtp(rawEmail, rawCode) {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode || '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) throw new VerificationError(400, 'Enter the 6-digit code from the email.');

  const INVALID = 'That code is invalid or has expired. Request a new one.';
  const row = await prisma.emailVerification.findUnique({ where: { email } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) throw new VerificationError(400, INVALID);
  if (row.verified) {
    // Already verified (a double submit): hand back a token for the same row.
    return { verified: true, email, verificationToken: signToken('signup', { email, verificationId: row.id }) };
  }

  // Claim an attempt BEFORE comparing, in one conditional update.
  const priorAttempts = row.attempts;
  const { count: claimed } = await prisma.emailVerification.updateMany({
    where: { id: row.id, verified: false, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } }
  });
  if (!claimed) throw new VerificationError(429, 'Too many wrong codes. Request a new code.');

  if (!sameHash(row.codeHash, hashCode(email, code))) {
    const left = Math.max(0, MAX_ATTEMPTS - (priorAttempts + 1));
    throw left > 0
      ? new VerificationError(400, `That code isn't right. ${left} attempt${left === 1 ? '' : 's'} left.`, { attemptsLeft: left })
      : new VerificationError(429, 'Too many wrong codes. Request a new code.', { attemptsLeft: 0 });
  }

  await prisma.emailVerification.update({ where: { id: row.id }, data: { verified: true, verifiedAt: new Date() } });
  return { verified: true, email, verificationToken: signToken('signup', { email, verificationId: row.id }) };
}

/**
 * For /register/complete, inside its transaction: the token must be valid,
 * name this address, and match a verified, unused, recent row — which is then
 * consumed, so one verification creates one account.
 * @param {object} tx a Prisma transaction client
 * @returns {Promise<boolean>} false = not verified (the caller answers 403)
 */
async function claimVerification(tx, rawEmail, token) {
  const email = normalizeEmail(rawEmail);
  const claims = verifyToken(String(token || ''), 'signup');
  if (!claims || claims.email !== email || !claims.verificationId) return false;
  const { count } = await tx.emailVerification.updateMany({
    where: {
      id: claims.verificationId, email, verified: true, usedAt: null,
      verifiedAt: { gt: new Date(Date.now() - VERIFIED_TTL_MS) }
    },
    data: { usedAt: new Date() }
  });
  return count === 1;
}

module.exports = {
  sendSignupOtp,
  verifySignupOtp,
  claimVerification,
  otpEmail,
  VerificationError,
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_ATTEMPTS
};
