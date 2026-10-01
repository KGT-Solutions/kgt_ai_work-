// Transactional email. Sends through Resend's HTTP API when RESEND_API_KEY and
// MAIL_FROM are set (no SDK — plain fetch). Without them:
//   - outside production, the message is printed to the API log so the
//     password-reset flow can be tested locally ("dev mail");
//   - in production (DEPLOY_ENV=production) nothing is printed — codes must
//     never land in production logs — and the send reports failure.

const RESEND_URL = 'https://api.resend.com/emails';

// Sender address. EMAIL_FROM is accepted too: it's the name this project's
// older .env files use, and with only that set no mail was ever sent.
function mailFrom() {
  return String(process.env.MAIL_FROM || process.env.EMAIL_FROM || '').trim();
}

function mailConfigured() {
  return !!(String(process.env.RESEND_API_KEY || '').trim() && mailFrom());
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, devSummary?: string }} msg
 *   devSummary: what to print in dev mode instead of the whole body
 * @returns {Promise<{ sent: boolean, via: 'resend'|'dev-log'|'none', error?: string }>}
 */
async function sendMail({ to, subject, text, html, devSummary }) {
  if (mailConfigured()) {
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ from: mailFrom(), to: [to], subject, text, ...(html ? { html } : {}) })
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[mailer] Resend rejected the message (${res.status}): ${body.slice(0, 200)}`);
        return { sent: false, via: 'resend', error: `HTTP ${res.status}` };
      }
      return { sent: true, via: 'resend' };
    } catch (err) {
      console.error(`[mailer] could not reach Resend: ${err.message}`);
      return { sent: false, via: 'resend', error: err.message };
    }
  }

  if (process.env.DEPLOY_ENV === 'production') {
    console.error('[mailer] RESEND_API_KEY / MAIL_FROM (or EMAIL_FROM) not set — email not sent.');
    return { sent: false, via: 'none', error: 'Email is not configured' };
  }
  console.log(`[mailer:dev] to=${to} subject="${subject}" ${devSummary || text}`);
  return { sent: true, via: 'dev-log' };
}

module.exports = { sendMail, mailConfigured, mailFrom };
