const provider = (process.env.SMS_PROVIDER || '').toLowerCase();

function toIndianMobile10(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 10) return digits;
  return null;
}

async function sendViaTwilio(phone, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in apps/api/.env');
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({ To: phone, From: from, Body: message });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Failed to send SMS via Twilio');
}

async function sendViaTwilioWhatsApp(phone, otp) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  if (!sid || !token) {
    throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in apps/api/.env');
  }

  const to = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: `Your Society App verification code is ${otp}. It is valid for 10 minutes. Do not share this code.`
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Failed to send OTP via Twilio WhatsApp');
}

async function sendViaMsg91(phone, otp) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  if (!authKey) {
    throw new Error('MSG91 is not configured. Set MSG91_AUTH_KEY (and optionally MSG91_TEMPLATE_ID) in apps/api/.env');
  }

  const mobile = phone.replace('+', '');
  const res = await fetch('https://control.msg91.com/api/v5/otp', {
    method: 'POST',
    headers: {
      authkey: authKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      template_id: templateId || undefined,
      mobile,
      otp,
      otp_length: 6,
      otp_expiry: 10
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.type === 'error') {
    throw new Error(data.message || data.error || 'Failed to send OTP via MSG91');
  }
}

async function sendViaFast2Sms(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    throw new Error('Fast2SMS is not configured. Set FAST2SMS_API_KEY in apps/api/.env');
  }

  const mobile = toIndianMobile10(phone);
  if (!mobile) {
    throw new Error('Fast2SMS only supports 10-digit Indian mobile numbers (+91XXXXXXXXXX)');
  }

  const otpId = process.env.FAST2SMS_OTP_ID;
  const headers = {
    authorization: apiKey,
    'Content-Type': 'application/json',
    accept: 'application/json'
  };

  let res;
  if (otpId) {
    res = await fetch('https://www.fast2sms.com/dev/otp/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mobile,
        otp_id: otpId,
        otp,
        otp_length: 6,
        otp_expiry: 10
      })
    });
  } else {
    res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        route: 'otp',
        variables_values: otp,
        numbers: mobile
      })
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!data.return) {
    throw new Error(data.message || 'Failed to send OTP via Fast2SMS');
  }
}

async function sendOtpSms(phone, otp) {
  const message = `Your Society App verification code is ${otp}. It is valid for 10 minutes. Do not share this code.`;

  if (provider === 'msg91') {
    await sendViaMsg91(phone, otp);
    return;
  }

  if (provider === 'fast2sms') {
    await sendViaFast2Sms(phone, otp);
    return;
  }

  if (provider === 'twilio-whatsapp') {
    await sendViaTwilioWhatsApp(phone, otp);
    return;
  }

  if (provider === 'twilio') {
    await sendViaTwilio(phone, message);
    return;
  }

  throw new Error(
    'SMS provider is not configured. Set SMS_PROVIDER to twilio-whatsapp, fast2sms, msg91, or twilio in apps/api/.env.'
  );
}

function isSmsConfigured() {
  if (provider === 'twilio-whatsapp') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  }
  if (provider === 'fast2sms') {
    return !!process.env.FAST2SMS_API_KEY;
  }
  if (provider === 'twilio') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  }
  if (provider === 'msg91') {
    return !!process.env.MSG91_AUTH_KEY;
  }
  return false;
}

module.exports = { sendOtpSms, isSmsConfigured };
