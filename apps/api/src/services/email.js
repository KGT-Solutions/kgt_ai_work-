const { Resend } = require('resend');

function getProvider() {
  return (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
}

function isEmailConfigured() {
  if (getProvider() === 'resend') {
    return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  }
  return false;
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at < 1) return value;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * Generic transactional email via Resend.
 * @param {{ to: string|string[], subject: string, text?: string, html?: string }} opts
 */
async function sendMail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw Object.assign(new Error('Email sender is not configured. Set EMAIL_FROM in apps/api/.env'), {
      statusCode: 503
    });
  }

  if (getProvider() !== 'resend') {
    throw Object.assign(new Error(`Unsupported EMAIL_PROVIDER "${getProvider()}". Use "resend".`), {
      statusCode: 503
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('Resend is not configured. Set RESEND_API_KEY in apps/api/.env'), {
      statusCode: 503
    });
  }

  const recipients = (Array.isArray(to) ? to : [to])
    .map((addr) => String(addr || '').trim())
    .filter((addr) => isValidEmail(addr));

  if (!recipients.length) {
    throw Object.assign(new Error('No valid recipient email address'), { statusCode: 400 });
  }
  if (!subject?.trim()) {
    throw Object.assign(new Error('Email subject is required'), { statusCode: 400 });
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: recipients,
    subject: subject.trim(),
    text: text || undefined,
    html: html || undefined
  });

  if (error) {
    throw Object.assign(new Error(error.message || 'Failed to send email'), { statusCode: 502 });
  }

  return { id: data?.id || null, to: recipients };
}

async function sendOtpEmail(to, code) {
  return sendMail({
    to,
    subject: 'Your verification code',
    text: `Your Society App verification code is ${code}. It expires in 10 minutes.`,
    html: `
      <p>Your Society App verification code is:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    `
  });
}

module.exports = {
  isEmailConfigured,
  isValidEmail,
  maskEmail,
  sendMail,
  sendOtpEmail
};
