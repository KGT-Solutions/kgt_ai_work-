const { normalizePhone } = require('../lib/phone');

function getTwilioAuth() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !serviceSid) {
    throw new Error(
      'Twilio Verify is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID in apps/api/.env'
    );
  }
  return {
    sid,
    token,
    serviceSid,
    channel: (process.env.TWILIO_VERIFY_CHANNEL || 'whatsapp').toLowerCase(),
    authHeader: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
  };
}

async function sendTwilioVerification(phone, channel = process.env.TWILIO_VERIFY_CHANNEL || 'sms') {
  const { serviceSid, authHeader } = getTwilioAuth();

  const res = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: phone, Channel: channel })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.code === 21608) {
      throw new Error(
        'This phone is not verified on your Twilio trial account. Add +917417466060 at twilio.com/console/phone-numbers/verified, or join the WhatsApp sandbox from this phone.'
      );
    }
    throw new Error(data.message || `Failed to send OTP via Twilio Verify (${channel})`);
  }
  console.log(`[OTP] Twilio Verify sent via ${channel} to ${phone}`);
  return { ...data, channel };
}

async function checkTwilioVerification(phone, code) {
  const { serviceSid, authHeader } = getTwilioAuth();

  const res = await fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: phone, Code: String(code).trim() })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.message || 'Invalid OTP' };
  if (data.status !== 'approved') return { ok: false, error: 'Invalid OTP' };
  return { ok: true, phone };
}

function isTwilioVerifyConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

module.exports = { sendTwilioVerification, checkTwilioVerification, isTwilioVerifyConfigured };
