const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { normalizePhone } = require('../lib/phone');
const { sendOtpSms, isSmsConfigured } = require('./sms');
const {
  sendTwilioVerification,
  checkTwilioVerification,
  isTwilioVerifyConfigured
} = require('./twilio-verify');
const { isEmailConfigured, isValidEmail, maskEmail, sendOtpEmail } = require('./email');

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const delivery = (process.env.OTP_DELIVERY || 'local').toLowerCase();
const DEV_BYPASS_CODE = process.env.DEV_BYPASS_CODE || '123456';

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function isDevBypassEnabled() {
  return process.env.DEV_BYPASS_AUTH === 'true';
}

function isDevBypassOtp(otp) {
  return isDevBypassEnabled() && String(otp).trim() === DEV_BYPASS_CODE;
}

function whatsappSandboxPhones() {
  return (process.env.TWILIO_WHATSAPP_PHONES || '')
    .split(',')
    .map((p) => normalizePhone(p.trim()))
    .filter(Boolean);
}

function usesWhatsAppSandbox(phone) {
  return whatsappSandboxPhones().includes(phone);
}

function getRouteForPhone(phone) {
  if (delivery === 'email') return 'email';
  if (delivery === 'twilio-verify') return 'verify';
  if (delivery === 'twilio-routed') {
    return usesWhatsAppSandbox(phone) ? 'whatsapp-sandbox' : 'verify-sms';
  }
  return 'local-sms';
}

function hashOtp(code) {
  const pepper = process.env.JWT_SECRET || 'dev-secret';
  return crypto.createHash('sha256').update(`${code}:${pepper}`).digest('hex');
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

async function persistLocalOtp(normalized, code) {
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.otpSession.deleteMany({ where: { phone: normalized } });
  await prisma.otpSession.create({
    data: { phone: normalized, codeHash: hashOtp(code), expiresAt }
  });
}

async function issueLocalWhatsAppOtp(normalized) {
  const code = generateOtpCode();
  await persistLocalOtp(normalized, code);
  await sendOtpSms(normalized, code);
  console.log(`[OTP] WhatsApp/SMS sent to ${normalized}`);
  return { phone: normalized, channel: 'whatsapp' };
}

/**
 * Resolve destination email for OTP.
 * - login: look up User by phone (must exist + have email)
 * - signup: require email in the request body
 */
async function resolveEmailDestination(normalized, { email, purpose } = {}) {
  const intent = (purpose || (email ? 'signup' : 'login')).toLowerCase();

  if (intent === 'signup') {
    const trimmed = String(email || '').trim().toLowerCase();
    if (!trimmed) {
      throw httpError('Email is required to send a signup verification code.', 400);
    }
    if (!isValidEmail(trimmed)) {
      throw httpError('Enter a valid email address.', 400);
    }
    return { email: trimmed, purpose: 'signup' };
  }

  const user = await prisma.user.findUnique({ where: { phone: normalized } });
  if (!user) {
    throw httpError('No account found. Please sign up with a Building Code.', 404);
  }
  if (!user.email || !String(user.email).trim()) {
    throw httpError(
      'No email is saved on this account. Add an email in profile or contact your building admin.',
      400
    );
  }
  if (!isValidEmail(user.email)) {
    throw httpError('The email on this account is invalid. Please update it before requesting OTP.', 400);
  }
  return { email: String(user.email).trim().toLowerCase(), purpose: 'login' };
}

async function issueEmailOtp(normalized, options = {}) {
  const { email, purpose } = await resolveEmailDestination(normalized, options);
  const code = generateOtpCode();
  await persistLocalOtp(normalized, code);

  // Email delivery always attempts Resend when configured.
  // DEV_BYPASS_AUTH still allows verifying with DEV_BYPASS_CODE as a fallback.
  if (!isEmailConfigured()) {
    if (isDevBypassEnabled()) {
      console.log(
        `[OTP] Email not configured — dev bypass for ${normalized} → ${maskEmail(email)} (use ${DEV_BYPASS_CODE})`
      );
      return {
        phone: normalized,
        channel: 'dev-bypass',
        emailHint: maskEmail(email),
        purpose
      };
    }
    throw httpError(
      'Email OTP is not configured. Set RESEND_API_KEY and EMAIL_FROM in apps/api/.env',
      503
    );
  }

  try {
    await sendOtpEmail(email, code);
  } catch (e) {
    console.error('[OTP] email send failed:', e.message);
    throw httpError(
      e.message || 'Failed to send verification email. Check Resend configuration.',
      e.statusCode || 502
    );
  }

  console.log(`[OTP] Email sent to ${maskEmail(email)} for ${normalized}`);
  return {
    phone: normalized,
    channel: 'email',
    emailHint: maskEmail(email),
    purpose
  };
}

async function issueOtp(phone, options = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw httpError('Invalid phone number', 400);

  const route = getRouteForPhone(normalized);

  if (route === 'email') {
    return issueEmailOtp(normalized, options);
  }

  // Non-email channels: keep previous early bypass (no send)
  if (isDevBypassEnabled()) {
    console.log(`[OTP] Dev bypass enabled — use demo login or OTP ${DEV_BYPASS_CODE} for ${normalized}`);
    return { phone: normalized, channel: 'dev-bypass' };
  }

  if (route === 'verify' || route === 'verify-sms') {
    if (!isTwilioVerifyConfigured()) {
      throw httpError('Twilio Verify is not configured for this phone number.', 503);
    }
    const result = await sendTwilioVerification(normalized, 'sms');
    return { phone: normalized, channel: result.channel || 'sms' };
  }

  if (route === 'whatsapp-sandbox') {
    return issueLocalWhatsAppOtp(normalized);
  }
 
  return issueLocalWhatsAppOtp(normalized);
}

async function verifyLocalOtp(normalized, otp) {
  const session = await prisma.otpSession.findFirst({
    where: { phone: normalized },
    orderBy: { createdAt: 'desc' }
  });

  if (!session) return { ok: false, error: 'OTP expired or not requested. Please request a new code.' };
  if (session.expiresAt < new Date()) {
    await prisma.otpSession.delete({ where: { id: session.id } });
    return { ok: false, error: 'OTP expired. Please request a new code.' };
  }
  if (session.attempts >= MAX_ATTEMPTS) {
    await prisma.otpSession.delete({ where: { id: session.id } });
    return { ok: false, error: 'Too many failed attempts. Please request a new code.' };
  }

  const matches = session.codeHash === hashOtp(String(otp).trim());
  if (!matches) {
    await prisma.otpSession.update({
      where: { id: session.id },
      data: { attempts: { increment: 1 } }
    });
    return { ok: false, error: 'Invalid OTP' };
  }

  await prisma.otpSession.delete({ where: { id: session.id } });
  return { ok: true, phone: normalized };
}

async function verifyOtp(phone, otp) {
  const normalized = normalizePhone(phone);
  if (!normalized || !otp) return { ok: false, error: 'Invalid phone or OTP' };

  if (isDevBypassOtp(otp)) {
    console.log(`[OTP] Dev bypass login for ${normalized}`);
    return { ok: true, phone: normalized };
  }

  const route = getRouteForPhone(normalized);
  // Email OTPs are stored locally (hashed), same as local SMS
  if (route === 'email' || route === 'local-sms' || route === 'whatsapp-sandbox') {
    return verifyLocalOtp(normalized, otp);
  }

  if (route === 'verify' || route === 'verify-sms') {
    return checkTwilioVerification(normalized, otp);
  }

  return verifyLocalOtp(normalized, otp);
}

function isOtpConfigured() {
  if (isDevBypassEnabled()) return true;
  if (delivery === 'email') return isEmailConfigured();
  if (delivery === 'twilio-verify') return isTwilioVerifyConfigured();
  if (delivery === 'twilio-routed') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) &&
      (whatsappSandboxPhones().length > 0 || isTwilioVerifyConfigured());
  }
  return isSmsConfigured();
}

function getOtpStatus() {
  return {
    configured: isOtpConfigured(),
    devBypass: isDevBypassEnabled(),
    delivery,
    channel: delivery === 'email' ? 'email' : delivery,
    whatsappPhones: whatsappSandboxPhones(),
    smsProvider: process.env.SMS_PROVIDER || null,
    emailProvider: process.env.EMAIL_PROVIDER || null
  };
}

module.exports = {
  issueOtp,
  verifyOtp,
  normalizePhone,
  isOtpConfigured,
  getOtpStatus,
  isDevBypassEnabled,
  isValidEmail
};
