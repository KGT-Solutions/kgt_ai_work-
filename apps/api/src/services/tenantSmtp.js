const net = require('net');
const nodemailer = require('nodemailer');
const prisma = require('../lib/prisma');
const { encrypt, decrypt, encryptionConfigured } = require('../utils/encryption');
const { isPrivateAddress, resolvePublicHost } = require('./shared/netGuard');

// A tenant's own outbound SMTP. The password is encrypted at rest
// (utils/encryption.js) and is NEVER returned to the client — reads mask it.
// mailer.js asks resolveTenantTransport() at send time and falls back to the
// platform SMTP when a tenant has no enabled, usable config.

const MASK = '********'; // what the UI shows/sends instead of the real password
const PROVIDERS = ['gmail', 'outlook']; // known providers; anything else is treated as a custom server (null)
const CONNECT_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

class SmtpConfigError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SmtpConfigError';
    this.statusCode = statusCode;
  }
}

function requiredString(value, field, max = 255) {
  const s = String(value ?? '').trim();
  if (!s) throw new SmtpConfigError(`${field} is required`);
  if (s.length > max) throw new SmtpConfigError(`${field} must be ${max} characters or fewer`);
  return s;
}

// The host and port are tenant-supplied and the server connects to them, so
// left open this was an internal port scanner: the "test" told an open service
// (its banner echoed back), a silent port and a closed one apart, for any host
// and any of 65535 ports. Now: mail ports only, public hosts only (checked at
// connect time against the address actually dialled), fixed error wording.
const SMTP_PORTS = [25, 465, 587, 2525];
const PRIVATE_NAME_RE = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.localdomain)$/i;

function validatePort(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || !SMTP_PORTS.includes(n)) {
    throw new SmtpConfigError('smtpPort must be an SMTP port: 587 (STARTTLS), 465 (SSL), 25 or 2525');
  }
  return n;
}

// The cheap, no-DNS part of the host check, so an obviously internal host is
// refused when it's typed rather than when the first email fails. The real
// check happens at connect time (smtpTarget).
function validateHost(value) {
  const host = requiredString(value, 'smtpHost').toLowerCase().replace(/^\[|\]$/g, '');
  if ((net.isIP(host) && isPrivateAddress(host)) || PRIVATE_NAME_RE.test(host)) {
    throw new SmtpConfigError('smtpHost must be your email provider\'s public SMTP server, not a private network address');
  }
  return host;
}

/**
 * Resolve the SMTP host and insist it is public; the IP to connect to. Dialling
 * that IP (with TLS still verified against the hostname) means nothing can
 * re-resolve the name to an internal address between this check and the
 * connection — the same DNS-rebinding defence as the crawler's.
 * @throws {SmtpConfigError}
 */
async function smtpTarget(host) {
  try {
    return await resolvePublicHost(host);
  } catch (err) {
    if (err.code === 'EPRIVATE') {
      throw new SmtpConfigError('smtpHost resolves to a private network address — use your email provider\'s public SMTP server');
    }
    throw new SmtpConfigError(`Could not find the SMTP server "${host}"`);
  }
}

// What a tenant sees when a test fails: fixed wording per category. Never the
// server's own reply (a non-mail service answers with its banner), and never
// mailer.js's hints, which describe the PLATFORM's SMTP — its host and env
// var names — not the tenant's.
const TEST_FAILURES = {
  auth: { error: 'The server rejected the username or password.', hint: 'Check the SMTP username and password. Accounts with 2-step verification (Gmail, Microsoft 365) need an app password.' },
  timeout: { error: 'The server did not answer in time.', hint: 'Check the host and port, and that the server accepts connections from the internet.' },
  tls: { error: 'A secure (TLS) connection could not be set up.', hint: 'Use port 587 for STARTTLS, or port 465 for SSL.' },
  connection: { error: 'Could not connect to that server and port.', hint: 'Check the SMTP host and port with your email provider.' },
  temporary: { error: 'The server is temporarily refusing connections.', hint: 'Try again in a few minutes.' },
  rejected: { error: 'The server refused the connection.', hint: 'Check the account\'s SMTP settings with your email provider.' }
};
const UNKNOWN_FAILURE = { error: 'That server did not respond like an SMTP mail server.', hint: 'Check the host and port with your email provider.' };

// A known provider key, or null for a custom server. Invalid strings are not
// an error — they just mean "custom" — so the UI is free to send anything.
function normalizeProvider(value) {
  const p = String(value ?? '').trim().toLowerCase();
  return PROVIDERS.includes(p) ? p : null;
}

// Accepts "user@host" or "Display Name <user@host>".
function validateFrom(value) {
  const s = requiredString(value, 'smtpFrom', 320);
  const addr = /<([^>]+)>/.test(s) ? s.match(/<([^>]+)>/)[1] : s;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim())) {
    throw new SmtpConfigError('smtpFrom must be a valid email address (optionally in "Name <email@domain>" form)');
  }
  return s;
}

// nodemailer options from plain credentials. STARTTLS is required on non-465
// ports so the password never crosses the wire in plaintext. `ip` is the
// resolved, checked address to dial; TLS is still verified against `host`.
function buildTransportConfig({ host, ip, port, user, pass, secure }) {
  const sec = typeof secure === 'boolean' ? secure : port === 465;
  return {
    host: ip || host,
    port,
    secure: sec,
    requireTLS: !sec,
    ...(ip && ip !== host ? { tls: { servername: host } } : {}),
    auth: user ? { user, pass } : undefined,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS
  };
}

function row(tenantId) {
  return prisma.tenantSmtpConfig.findUnique({ where: { tenantId } });
}

/**
 * The tenant's config for the UI, with the password masked — never the
 * ciphertext and never the plaintext.
 */
async function getMaskedConfig(tenantId) {
  const r = await row(tenantId);
  if (!r) {
    return { configured: false, isEnabled: false, provider: null, smtpHost: '', smtpPort: 587, smtpUser: '', smtpFrom: '', hasPassword: false, smtpPass: '' };
  }
  return {
    configured: true,
    isEnabled: r.isEnabled,
    provider: r.provider || null,
    smtpHost: r.smtpHost,
    smtpPort: r.smtpPort,
    smtpUser: r.smtpUser,
    smtpFrom: r.smtpFrom,
    hasPassword: !!r.smtpPass,
    smtpPass: r.smtpPass ? MASK : '' // placeholder only; the real value never leaves the server
  };
}

/**
 * Creates or updates the tenant's SMTP config. The password is encrypted
 * before it touches the database; sending the mask (or nothing) keeps the
 * stored password so the form can be saved without re-typing it.
 * @throws {SmtpConfigError} on invalid input (400) or missing ENCRYPTION_KEY (503)
 */
async function upsertConfig(tenantId, body) {
  if (!encryptionConfigured()) {
    throw new SmtpConfigError('Secure storage is not configured on the server (ENCRYPTION_KEY is unset). Contact your administrator.', 503);
  }
  const smtpHost = validateHost(body?.smtpHost);
  const smtpPort = validatePort(body?.smtpPort);
  const smtpUser = requiredString(body?.smtpUser, 'smtpUser');
  const smtpFrom = validateFrom(body?.smtpFrom);
  const isEnabled = body?.isEnabled === undefined ? true : !!body.isEnabled;

  const existing = await row(tenantId);
  const rawPass = typeof body?.smtpPass === 'string' ? body.smtpPass : '';
  let smtpPass;
  if (rawPass && rawPass !== MASK) {
    smtpPass = encrypt(rawPass); // a real new password
  } else if (existing?.smtpPass) {
    smtpPass = existing.smtpPass; // unchanged — keep the stored ciphertext
  } else {
    throw new SmtpConfigError('smtpPass is required');
  }

  const data = { provider: normalizeProvider(body?.provider), smtpHost, smtpPort, smtpUser, smtpFrom, smtpPass, isEnabled };
  await prisma.tenantSmtpConfig.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  return getMaskedConfig(tenantId);
}

/**
 * Verifies SMTP credentials without saving anything: logs in to the server
 * and reports success/failure. The mask (or empty password) tests against the
 * stored password, so a saved config can be re-tested without re-typing it.
 * @returns {Promise<{ ok: boolean, reason?: string, error?: string, hint?: string }>}
 */
async function testConfig(tenantId, body) {
  const { classifyMailError } = require('./mailer'); // lazy: avoids any load-order cycle
  let cfg;
  try {
    const host = validateHost(body?.smtpHost);
    const port = validatePort(body?.smtpPort);
    const user = requiredString(body?.smtpUser, 'smtpUser');
    const rawPass = typeof body?.smtpPass === 'string' ? body.smtpPass : '';
    let pass = rawPass;
    if (!pass || pass === MASK) {
      const r = await row(tenantId);
      pass = r?.smtpPass ? decrypt(r.smtpPass) : '';
    }
    if (!pass) throw new SmtpConfigError('Enter a password to test with');
    const ip = await smtpTarget(host); // refuses a private answer BEFORE anything connects
    cfg = buildTransportConfig({
      host, ip, port, user, pass,
      secure: typeof body?.smtpSecure === 'boolean' ? body.smtpSecure : undefined
    });
  } catch (err) {
    if (err instanceof SmtpConfigError) return { ok: false, reason: 'invalid', error: err.message };
    return { ok: false, reason: 'unknown', error: 'Could not read the stored credentials to test.' };
  }

  const transport = nodemailer.createTransport(cfg);
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    const { reason } = classifyMailError(err);
    return { ok: false, reason, ...(TEST_FAILURES[reason] || UNKNOWN_FAILURE) };
  } finally {
    transport.close();
  }
}

/**
 * For mailer.js: a ready-to-send override for this tenant, or null when there
 * is no enabled/usable config (the caller then uses the platform SMTP). Never
 * throws — a decryption failure (e.g. ENCRYPTION_KEY rotated) logs once and
 * returns null so email still goes out via the platform rather than failing.
 * @returns {Promise<{ config: object, from: string } | null>}
 */
async function resolveTenantTransport(tenantId) {
  if (!tenantId || !encryptionConfigured()) return null;
  const r = await row(tenantId);
  if (!r || !r.isEnabled || !r.smtpHost || !r.smtpPass) return null;
  let pass;
  try {
    pass = decrypt(r.smtpPass);
  } catch (err) {
    console.error(`[tenantSmtp] tenant ${tenantId}: could not decrypt SMTP password (has ENCRYPTION_KEY changed?) — using platform SMTP. ${err.message}`);
    return null;
  }
  // The same rules as a test, at every send: a config saved before the rules
  // existed, or a host that now resolves privately, is never dialled.
  let host;
  let ip;
  try {
    host = validateHost(r.smtpHost);
    validatePort(r.smtpPort);
    ip = await smtpTarget(host);
  } catch (err) {
    console.warn(`[tenantSmtp] tenant ${tenantId}: SMTP config refused (${err.message}) — using platform SMTP.`);
    return null;
  }
  return {
    config: buildTransportConfig({ host, ip, port: r.smtpPort, user: r.smtpUser, pass, secure: r.smtpPort === 465 }),
    from: r.smtpFrom
  };
}

module.exports = { getMaskedConfig, upsertConfig, testConfig, resolveTenantTransport, SmtpConfigError, MASK, SMTP_PORTS };
