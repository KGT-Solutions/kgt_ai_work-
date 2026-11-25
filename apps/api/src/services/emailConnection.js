const defaultPrisma = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { encrypt, decrypt, encryptionConfigured } = require('../utils/encryption');
const { signToken, verifyToken } = require('../utils/authTokens');
const emailOAuth = require('./emailOAuth');

// Email Connection (Feature 10) — storage + orchestration over the protocol
// layer (services/emailOAuth.js). Owns the one TenantEmailSettings row per
// tenant: the Google/Microsoft OAuth connection (tokens encrypted at rest, like
// SMTP passwords, and NEVER returned to the client) and the per-email-type
// toggles. mailer.js asks resolveOAuthSender() at send time and prefers it over
// the tenant's SMTP and the platform transport. Custom SMTP (services/
// tenantSmtp.js) is untouched and keeps working exactly as before.

// Toggle name (API/UI) → database column. These are the tenant-controllable
// categories; account-security email (password reset, signup verification) is
// never on this list and always sends.
const TOGGLE_COLUMNS = Object.freeze({
  leadAlerts: 'leadAlertsEnabled',
  attentionAlerts: 'attentionAlertsEnabled',
  visitorConfirmation: 'visitorConfirmationEnabled'
});

class EmailConnectionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'EmailConnectionError';
    this.statusCode = statusCode;
  }
}

function safeDecrypt(value) {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

function toggleView(row) {
  return {
    leadAlerts: row?.leadAlertsEnabled !== false,
    attentionAlerts: row?.attentionAlertsEnabled !== false,
    visitorConfirmation: row?.visitorConfirmationEnabled !== false
  };
}

/**
 * The email-settings view for the dashboard: which providers are configured on
 * the server, whether this tenant is connected (and to what mailbox), and the
 * per-email toggles. Never returns tokens.
 */
async function getStatus(tenant, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantEmailSettings.findUnique({ where: { tenantId: tenant.id } }).catch(() => null);
  return {
    providers: {
      google: { configured: emailOAuth.providerConfigured('google') },
      microsoft: { configured: emailOAuth.providerConfigured('microsoft') }
    },
    anyConfigured: emailOAuth.anyProviderConfigured(),
    connected: !!(row && row.provider && row.refreshToken),
    provider: row?.provider || null,
    email: row?.oauthEmail || null,
    connectedAt: row?.connectedAt || null,
    connectedBy: row?.connectedBy || null,
    toggles: toggleView(row)
  };
}

/**
 * Start the OAuth flow: hand back the provider consent URL. A signed `state`
 * binds the callback to this tenant + provider (+ the actor who started it).
 * @returns {Promise<{ authUrl: string }>}
 */
async function beginConnect({ tenantId, provider, redirectUri, actor = null }, { prisma: _prisma = defaultPrisma } = {}) {
  const p = String(provider || '').trim().toLowerCase();
  if (!emailOAuth.isProvider(p)) throw new EmailConnectionError('Choose Google or Microsoft to connect.', 400);
  if (!encryptionConfigured()) {
    throw new EmailConnectionError('Secure storage is not configured on the server (ENCRYPTION_KEY is unset). Contact your administrator.', 503);
  }
  if (!emailOAuth.providerConfigured(p)) {
    throw new EmailConnectionError(`${p === 'google' ? 'Google' : 'Microsoft'} sign-in is not configured on this server yet.`, 503);
  }
  const state = signToken('email_oauth', { tenantId, provider: p, actor });
  return { authUrl: emailOAuth.authorizeUrl(p, { state, redirectUri }) };
}

/**
 * Finish the OAuth flow from the public callback: verify state, exchange the
 * code, and store the encrypted tokens + mailbox address. Keeps any existing
 * toggle preferences (upsert update doesn't touch them).
 * @returns {Promise<{ tenantId: string, provider: string, email: string|null }>}
 */
async function completeConnect({ state, code, redirectUri }, { prisma = defaultPrisma, fetchImpl = fetch } = {}) {
  const claims = verifyToken(state, 'email_oauth');
  if (!claims?.tenantId || !emailOAuth.isProvider(claims.provider)) {
    throw new EmailConnectionError('The connection link expired or is invalid. Start again from the dashboard.', 400);
  }
  const tokens = await emailOAuth.exchangeCode(claims.provider, { code, redirectUri, fetchImpl });
  const conn = {
    provider: claims.provider,
    oauthEmail: tokens.email,
    refreshToken: encrypt(tokens.refreshToken),
    accessToken: encrypt(tokens.accessToken),
    tokenExpiry: tokens.tokenExpiry,
    scope: tokens.scope,
    connectedAt: new Date(),
    connectedBy: claims.actor || null
  };
  await prisma.tenantEmailSettings.upsert({
    where: { tenantId: claims.tenantId },
    update: conn,
    create: { tenantId: claims.tenantId, ...conn }
  });
  return { tenantId: claims.tenantId, provider: claims.provider, email: tokens.email };
}

/** Remove the OAuth connection (keep the row + toggle preferences). Idempotent. */
async function disconnect(tenant, { prisma = defaultPrisma } = {}) {
  const existing = await prisma.tenantEmailSettings.findUnique({ where: { tenantId: tenant.id } }).catch(() => null);
  if (existing) {
    await prisma.tenantEmailSettings.update({
      where: { tenantId: tenant.id },
      data: { provider: null, oauthEmail: null, refreshToken: null, accessToken: null, tokenExpiry: null, scope: null, connectedAt: null, connectedBy: null }
    });
  }
  return getStatus(tenant, { prisma });
}

/** Update one or more per-email toggles. */
async function setToggles(tenant, patch = {}, { prisma = defaultPrisma } = {}) {
  const data = {};
  for (const [name, col] of Object.entries(TOGGLE_COLUMNS)) {
    if (patch[name] !== undefined) data[col] = !!patch[name];
  }
  if (!Object.keys(data).length) {
    throw new EmailConnectionError(`Send at least one of: ${Object.keys(TOGGLE_COLUMNS).join(', ')}`, 400);
  }
  await prisma.tenantEmailSettings.upsert({
    where: { tenantId: tenant.id },
    update: data,
    create: { tenantId: tenant.id, ...data }
  });
  return getStatus(tenant, { prisma });
}

/**
 * Whether a given email category may be sent for this tenant. Default ON (no
 * row, or the toggle unset). Fail-OPEN on a lookup error: a database blip must
 * never silently swallow mail — only an explicit stored `false` disables.
 * @param {'leadAlerts'|'attentionAlerts'|'visitorConfirmation'} type
 */
async function emailTypeEnabled(tenantId, type, { prisma = defaultPrisma } = {}) {
  const col = TOGGLE_COLUMNS[type];
  if (!col || !tenantId) return true;
  try {
    const row = await prisma.tenantEmailSettings.findUnique({ where: { tenantId }, select: { [col]: true } });
    return row ? row[col] !== false : true;
  } catch (err) {
    logger.warn(`[email] toggle lookup failed for tenant ${tenantId}/${type}: ${err.message}`);
    return true;
  }
}

// A valid access token for a stored connection, refreshing (and persisting the
// new token, best-effort) when the cached one is missing or stale.
async function accessTokenFor(row, { prisma, fetchImpl, now }) {
  if (emailOAuth.isTokenFresh(row.tokenExpiry, now) && row.accessToken) {
    const cached = safeDecrypt(row.accessToken);
    if (cached) return cached;
  }
  const refreshToken = safeDecrypt(row.refreshToken);
  if (!refreshToken) throw new emailOAuth.EmailOAuthError('could not read the stored refresh token (ENCRYPTION_KEY changed?)', 400);
  const fresh = await emailOAuth.refreshAccessToken(row.provider, { refreshToken, fetchImpl, now });
  try {
    await prisma.tenantEmailSettings.update({
      where: { tenantId: row.tenantId },
      data: {
        accessToken: encrypt(fresh.accessToken),
        tokenExpiry: fresh.tokenExpiry,
        ...(fresh.refreshToken ? { refreshToken: encrypt(fresh.refreshToken) } : {})
      }
    });
  } catch (err) {
    logger.warn(`[email] could not persist refreshed token for tenant ${row.tenantId}: ${err.message}`);
  }
  return fresh.accessToken;
}

/**
 * For mailer.js: a ready sender for this tenant's OAuth connection, or null
 * when there is none usable (not connected, provider no longer configured, or
 * the refresh token can't be decrypted). Never throws during resolution — a
 * null simply falls through to the tenant's SMTP / the platform transport. The
 * returned send() DOES throw on a send failure, so mailer can report it and
 * NOT silently resend from the platform identity.
 * @returns {Promise<{ provider: string, from: string|null, send: (msg) => Promise<void> } | null>}
 */
async function resolveOAuthSender(tenantId, { prisma = defaultPrisma, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!tenantId || !encryptionConfigured()) return null;
  let row;
  try {
    row = await prisma.tenantEmailSettings.findUnique({ where: { tenantId } });
  } catch {
    return null;
  }
  if (!row || !row.provider || !row.refreshToken) return null;
  if (!emailOAuth.providerConfigured(row.provider)) return null; // creds removed from env since connecting
  const { provider, oauthEmail } = row;
  return {
    provider,
    from: oauthEmail,
    send: async (msg) => {
      const accessToken = await accessTokenFor(row, { prisma, fetchImpl, now });
      await emailOAuth.sendEmail(provider, { ...msg, from: msg.from || oauthEmail, accessToken }, { fetchImpl });
    }
  };
}

module.exports = {
  getStatus,
  beginConnect,
  completeConnect,
  disconnect,
  setToggles,
  emailTypeEnabled,
  resolveOAuthSender,
  EmailConnectionError,
  TOGGLE_COLUMNS
};
