const crypto = require('node:crypto');
const os = require('node:os');
const mailer = require('./mailer');
const { store, keys } = require('../lib/sharedStore');
const { logger, getRequestId } = require('../lib/logger');

// Operator alerts: email the people who run this deployment when the server
// itself fails — an unhandled 500 (middleware/errorHandler.js), a stray
// unhandledRejection, or an uncaughtException (server.js). This is distinct
// from services/teamAlerts.js, which emails a TENANT'S team about their chats;
// these go to the PLATFORM operator, never to a tenant, and carry no
// visitor-typed content beyond whatever is already in the error itself.
//
// Recipients come from ERROR_ALERT_EMAIL (comma/space separated, up to 5).
// With none set the whole feature is a no-op, so a deployment that hasn't opted
// in never tries to send and nothing changes. ERROR_ALERTS_ENABLED=false also
// turns it off while keeping the address configured.
//
// A failing server tends to fail repeatedly, so alerts are throttled two ways,
// both via the shared store (so the throttle is one throttle across however
// many API containers run, and expires on its own):
//   - DEDUP: one email per distinct error signature (source + name + message +
//     top stack frame) per ERROR_ALERT_DEDUP_MIN, so a tight error loop sends
//     one mail, not thousands;
//   - CAP: at most ERROR_ALERT_MAX_PER_HOUR emails in total, so a storm of
//     *different* errors still can't flood the inbox.
// A throttled alert is not lost information: the error is already logged
// (logger.error) regardless.
//
// Everything here is fire-and-forget and never throws into its caller — it runs
// from the error handler and from process-level crash handlers, the last places
// that can afford a second failure.

const env = (name) => String(process.env[name] || '').trim();
const numberEnv = (name, fallback) => {
  const n = Number(env(name));
  return env(name) !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

const MAX_RECIPIENTS = 5;
const HOUR_MS = 60 * 60 * 1000;
const STACK_CHARS = 4000; // plenty for a stack, bounded so one mail can't balloon
const MSG_CHARS = 300;

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const alertsEnabled = () => env('ERROR_ALERTS_ENABLED').toLowerCase() !== 'false';
const dedupMs = () => numberEnv('ERROR_ALERT_DEDUP_MIN', 15) * 60 * 1000;
const maxPerHour = () => numberEnv('ERROR_ALERT_MAX_PER_HOUR', 10);

/** @returns {string[]} up to 5 distinct operator addresses from ERROR_ALERT_EMAIL; may be empty */
function recipients() {
  const list = String(env('ERROR_ALERT_EMAIL'))
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(isEmail);
  // Collapse duplicates so "a@b.com, a@b.com" doesn't email the same inbox twice.
  return [...new Set(list)].slice(0, MAX_RECIPIENTS);
}

const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t; };
const firstLine = (s) => String(s ?? '').split('\n')[0];

// The first real stack frame ("at foo (file:line:col)"), which — with the name
// and message — identifies the failure well enough to collapse a repeat loop.
function topFrame(stack) {
  const line = String(stack || '').split('\n').find((l) => l.trim().startsWith('at '));
  return line ? line.trim() : '';
}

// Collapse the volatile parts of a message so "the same error" dedups even when
// its text carries a changing id, IP, hex blob or number — otherwise a
// per-request failure in a loop would defeat the dedup (every message unique =
// every alert unique) and lean entirely on the hourly cap. Order matters: UUID
// and IP before the bare-number pass, which would otherwise eat their digits.
function normalizeMessage(msg) {
  return firstLine(msg)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>');
}

// A short, stable key for "the same error from the same place". Deliberately
// ignores volatile bits (timestamps, ids) via normalizeMessage + the top frame.
function signature(source, err) {
  const name = (err && err.name) || typeof err;
  const parts = `${source}|${name}|${normalizeMessage(err && err.message)}|${topFrame(err && err.stack)}`;
  return crypto.createHash('sha1').update(parts).digest('hex').slice(0, 16);
}

function buildMail({ source, err, requestId, req }) {
  const name = (err && err.name) || 'Error';
  const message = clip(firstLine(err && err.message) || String(err), MSG_CHARS);
  const subject = `[KGT API] ${source}: ${name}: ${message}`.slice(0, 200);

  // Path only, never the query string: a 500 can fire on a URL that carries a
  // token/secret in its query (reset links, signed URLs), and this email must
  // not leak it. req.path already excludes the query; split guards a plain
  // object (tests) or req.url that still has one.
  const rawPath = req && (req.path || req.originalUrl || req.url);
  const path = rawPath ? String(rawPath).split('?')[0] : '';
  const where = req && (req.method || path) ? `${req.method || ''} ${path}`.trim() : null;

  const rows = [
    ['Source', source],
    ['Host', os.hostname()],
    ['Environment', env('DEPLOY_ENV') || env('NODE_ENV') || 'development'],
    ['Time', new Date().toUTCString()],
    ...(requestId ? [['Request id', requestId]] : []),
    ...(where ? [['Request', where]] : []),
    ['Error', `${name}: ${message}`]
  ];

  const stack = clip(err && err.stack ? err.stack : `${name}: ${message}`, STACK_CHARS);
  const text = [
    'The KGT AI Hub API reported a server-side error.',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Stack:',
    stack,
    '',
    '-- KGT AI Hub operator alert'
  ].join('\n');

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const td = 'padding:4px 10px 4px 0;font-size:13px;line-height:1.5;vertical-align:top;';
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:20px 26px 6px;"><h1 style="margin:0 0 6px;font-size:18px;color:#b91c1c;">Server error: ${esc(name)}</h1>
<p style="margin:0 0 12px;font-size:13px;color:#334155;">${esc(message)}</p>
<table role="presentation" cellspacing="0" cellpadding="0">${rows.map(([k, v]) =>
    `<tr><td style="${td}color:#64748b;white-space:nowrap;">${esc(k)}</td><td style="${td}color:#0f172a;">${esc(v)}</td></tr>`).join('')}</table></td></tr>
<tr><td style="padding:6px 26px 18px;"><pre style="margin:0;padding:12px 14px;border-radius:8px;background:#0f172a;color:#e2e8f0;font-size:12px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-word;">${esc(stack)}</pre></td></tr>
</table></body></html>`;

  return { subject, text, html };
}

/**
 * Report a server-side error to the operator, throttled. Fire-and-forget: the
 * returned promise always resolves (never rejects) and callers need not await.
 * @param {Error|*} err
 * @param {{ source?: string, req?: object }} [opts]
 *   source: where it came from — 'http-500' | 'unhandledRejection' | 'uncaughtException'
 *   req:    the Express request, when there is one (adds method/path + its id)
 * @returns {Promise<{ sent: boolean, via?: string, reason?: string }>}
 */
async function notifyError(err, { source = 'error', req } = {}) {
  try {
    if (!alertsEnabled()) return { sent: false, reason: 'disabled' };
    const to = recipients();
    if (!to.length) return { sent: false, reason: 'no-recipient' };

    // Hourly cap first (a peek, so a throttled call consumes nothing), then the
    // per-signature dedup slot — only claimed when we're actually about to send,
    // so hitting the cap doesn't burn a signature's one allowed alert.
    if ((await store().countWindow(keys.errorAlert(), HOUR_MS)) >= maxPerHour()) {
      return { sent: false, reason: 'throttled' };
    }
    const sig = signature(source, err);
    if (!(await store().claimOnce(keys.errorAlertDedup(sig), dedupMs()))) {
      return { sent: false, reason: 'deduped' };
    }
    await store().incrWindow(keys.errorAlert(), HOUR_MS);

    const requestId = (req && req.id) || getRequestId();
    const mail = buildMail({ source, err, requestId, req });
    const result = await mailer.sendMail({ to, ...mail, label: `error alert (${source})` });
    if (result.sent && !result.simulated) {
      logger.warn('operator error alert sent', { source, via: result.via, recipients: to.length });
    } else if (!result.sent) {
      logger.warn('operator error alert could not be sent', { source, reason: result.reason });
    }
    return result;
  } catch (e) {
    // Last-ditch: the alerter itself failed. Log plainly (the logger is the one
    // thing we still trust) and swallow — never let crash reporting crash.
    try { logger.error('error-alert delivery failed', e); } catch { /* nothing more to do */ }
    return { sent: false, reason: 'exception' };
  }
}

/** For tests: clears the shared store, error-alert throttles included. */
function resetErrorAlertThrottle() {
  return store().reset();
}

module.exports = { notifyError, recipients, signature, resetErrorAlertThrottle };
