// Reads the emails the API really sent — over real SMTP — from Mailpit
// (https://mailpit.axllent.org), the mail catcher in docker-compose.e2e.yml.
const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';

async function search(to) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  return (await res.json()).messages || [];
}

/**
 * Waits for an email to `to` (optionally: whose subject matches, sent after
 * `since`) and returns { subject, text, html }.
 */
async function waitForEmail(to, { subject, since = 0, timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await search(to)).find((m) => (!subject || subject.test(m.Subject)) && new Date(m.Created).getTime() >= since);
    if (hit) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      return { subject: full.Subject, text: full.Text || '', html: full.HTML || '' };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No email to ${to}${subject ? ` matching ${subject}` : ''} within ${timeoutMs}ms`);
}

/** The 6-digit code in the newest matching email. */
async function waitForCode(to, opts) {
  const mail = await waitForEmail(to, opts);
  const code = (mail.text || mail.html).match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No 6-digit code in "${mail.subject}"`);
  return code;
}

module.exports = { waitForEmail, waitForCode };
