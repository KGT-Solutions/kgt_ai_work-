const { encrypt, decrypt } = require('../../utils/encryption');

// Zoho OAuth2 token manager. Two jobs, both region-aware:
//   1. resolveDomains(region) — turn a tenant's data-centre region ('in',
//      'com', 'eu', ...) into the right accounts + API base URLs. A lead
//      captured for a .in tenant must hit zohoapis.in, not .com, or Zoho
//      answers INVALID_TOKEN even with a valid token.
//   2. getAccessToken(...) — return a usable access token for an integration,
//      refreshing it from the long-lived refresh token when it's expired (or
//      about to), then persisting the new token (AES-256-GCM, like SMTP
//      passwords) and its expiry so the next call reuses it.
//
// The OAuth client (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET) is the platform's
// single registered app; the region and tokens are per tenant. The HTTP call
// is injectable (fetchImpl) so unit tests never touch the network, and stored
// tokens are never logged or returned to a client.

const DEFAULT_REGION = 'com';
// Refresh a little before the real expiry, so a token never expires mid-request.
const EXPIRY_SKEW_MS = 60 * 1000;
const TIMEOUT_MS = 15000;
// Scopes the dashboard requests when a tenant connects Zoho: read/write Leads
// and Notes is enough for the sync. Override with ZOHO_SCOPE if a tenant's org
// needs more. access_type=offline is what makes Zoho return a refresh token.
const DEFAULT_SCOPE = 'ZohoCRM.modules.leads.ALL,ZohoCRM.modules.notes.ALL,ZohoCRM.settings.ALL';

// Zoho's accounts + API hosts per data centre. The accounts host mints tokens;
// the API host serves /crm. Unknown regions fall back to the global (.com) DC.
const DATA_CENTERS = {
  com: { accounts: 'https://accounts.zoho.com', api: 'https://www.zohoapis.com' },
  in: { accounts: 'https://accounts.zoho.in', api: 'https://www.zohoapis.in' },
  eu: { accounts: 'https://accounts.zoho.eu', api: 'https://www.zohoapis.eu' },
  au: { accounts: 'https://accounts.zoho.com.au', api: 'https://www.zohoapis.com.au' },
  jp: { accounts: 'https://accounts.zoho.jp', api: 'https://www.zohoapis.jp' },
  ca: { accounts: 'https://accounts.zohocloud.ca', api: 'https://www.zohoapis.ca' },
  sa: { accounts: 'https://accounts.zoho.sa', api: 'https://www.zohoapis.sa' }
};

const readKey = (name) => String(process.env[name] || '').trim();

class CrmError extends Error {
  // retryable: a transient failure worth backing off and retrying (429, 5xx,
  // network). authFailure: Zoho rejected the access token itself (401,
  // INVALID_TOKEN) — fixed by minting a new one, not by waiting.
  constructor(message, statusCode = 502, { retryable = false, authFailure = false } = {}) {
    super(message);
    this.name = 'CrmError';
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.authFailure = authFailure;
  }
}

/** The platform's Zoho OAuth app credentials are configured. */
function isZohoConfigured() {
  return !!(readKey('ZOHO_CLIENT_ID') && readKey('ZOHO_CLIENT_SECRET'));
}

/**
 * A server-wide Zoho refresh token (the Self Client / single-org setup:
 * ZOHO_REFRESH_TOKEN + ZOHO_API_DOMAIN/ZOHO_AUTH_DOMAIN). When present, a
 * tenant connects by adopting it directly — no browser OAuth redirect, which a
 * Self Client can't do anyway.
 */
function hasServerRefreshToken() {
  return isZohoConfigured() && !!readKey('ZOHO_REFRESH_TOKEN');
}
function serverRefreshToken() {
  return readKey('ZOHO_REFRESH_TOKEN') || null;
}
/** The region implied by the configured ZOHO_API_DOMAIN / ZOHO_AUTH_DOMAIN (e.g. .in), else the default. */
function serverRegion() {
  const api = readKey('ZOHO_API_DOMAIN');
  const accounts = readKey('ZOHO_AUTH_DOMAIN');
  for (const [r, d] of Object.entries(DATA_CENTERS)) {
    if ((api && d.api === api) || (accounts && d.accounts === accounts)) return r;
  }
  return DEFAULT_REGION;
}

/** Normalise a stored region to a known data-centre key. */
function normalizeRegion(region) {
  const r = String(region || '').trim().toLowerCase().replace(/^\./, '');
  return Object.prototype.hasOwnProperty.call(DATA_CENTERS, r) ? r : DEFAULT_REGION;
}

/**
 * @param {string} region e.g. 'in', 'com', 'eu'
 * @returns {{ region: string, accounts: string, api: string }}
 */
function resolveDomains(region) {
  const r = normalizeRegion(region);
  return { region: r, ...DATA_CENTERS[r] };
}

/**
 * The Zoho consent URL to send the tenant's browser to. `state` is our signed
 * token binding the flow to a tenant + region; `redirectUri` must match one
 * registered on the Zoho OAuth app and is where Zoho sends the code back.
 */
function authorizeUrl({ region, redirectUri, state }) {
  const clientId = readKey('ZOHO_CLIENT_ID');
  if (!clientId) throw new CrmError('Zoho OAuth client is not configured', 503);
  const { accounts } = resolveDomains(region);
  const params = new URLSearchParams({
    scope: readKey('ZOHO_SCOPE') || DEFAULT_SCOPE,
    client_id: clientId,
    response_type: 'code',
    access_type: 'offline', // required for a refresh token
    prompt: 'consent',      // re-consent so a refresh token is always returned
    redirect_uri: redirectUri,
    state
  });
  return `${accounts}/oauth/v2/auth?${params.toString()}`;
}

/**
 * Exchange the authorization code from the consent redirect for an access +
 * refresh token. Returns both (decrypted), the API domain and the expiry.
 */
async function exchangeCode({ code, region, redirectUri, fetchImpl = fetch, now = Date.now() }) {
  const clientId = readKey('ZOHO_CLIENT_ID');
  const clientSecret = readKey('ZOHO_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new CrmError('Zoho OAuth client is not configured', 503);
  if (!code) throw new CrmError('missing authorization code', 400);

  const { accounts, api } = resolveDomains(region);
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(`${accounts}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal
    });
    if (!res.ok) throw new CrmError(`Zoho code exchange failed (${res.status})`, 502);
    data = await res.json();
  } catch (err) {
    if (err instanceof CrmError) throw err;
    throw new CrmError(`Zoho code exchange request failed: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!data || data.error || !data.access_token) {
    throw new CrmError(`Zoho code exchange rejected: ${data?.error || 'no access_token returned'}`, 502);
  }
  // Without a refresh token we can never renew: Zoho only returns one on the
  // first consent, so surface this rather than storing a dead connection.
  if (!data.refresh_token) {
    throw new CrmError('Zoho did not return a refresh token — re-authorize with offline access', 502);
  }
  const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    apiDomain: data.api_domain || api,
    tokenExpiry: new Date(now + expiresInMs)
  };
}

/** Safe decrypt: a corrupt/rotated ciphertext reads as "no token" rather than throwing. */
function safeDecrypt(value) {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

function tokenIsFresh(integration, now) {
  if (!integration.accessToken || !integration.tokenExpiry) return false;
  return new Date(integration.tokenExpiry).getTime() - EXPIRY_SKEW_MS > now;
}

/**
 * Exchange the integration's refresh token for a new access token at the
 * tenant's data centre. Returns the decrypted access token and the API domain.
 */
async function refreshAccessToken({ integration, fetchImpl, now }) {
  const clientId = readKey('ZOHO_CLIENT_ID');
  const clientSecret = readKey('ZOHO_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new CrmError('Zoho OAuth client is not configured', 503);

  const refreshToken = safeDecrypt(integration.refreshToken);
  if (!refreshToken) throw new CrmError('no Zoho refresh token on file for this tenant', 400);

  const { accounts, api } = resolveDomains(integration.region);
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let data;
  try {
    const res = await fetchImpl(`${accounts}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal
    });
    // A 5xx or network blip is worth retrying; a 4xx (bad/revoked token) is not.
    if (!res.ok) throw new CrmError(`Zoho token refresh failed (${res.status})`, 502, { retryable: res.status >= 500 || res.status === 429 });
    data = await res.json();
  } catch (err) {
    if (err instanceof CrmError) throw err;
    throw new CrmError(`Zoho token refresh request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }

  // Zoho signals an auth problem with 200 + an `error` field, not an HTTP 4xx.
  if (!data || data.error || !data.access_token) {
    throw new CrmError(`Zoho token refresh rejected: ${data?.error || 'no access_token returned'}`, 502);
  }
  const expiresInMs = (Number(data.expires_in) || 3600) * 1000;
  return {
    accessToken: String(data.access_token),
    apiDomain: data.api_domain || api,
    tokenExpiry: new Date(now + expiresInMs)
  };
}

// Refresh, then persist the new token (encrypted). Persisting is best-effort —
// a storage failure must not fail the sync that triggered the refresh; the
// token is still usable for this call, and the next call simply refreshes again.
async function refreshAndPersist({ integration, prisma, fetchImpl, now }) {
  const fresh = await refreshAccessToken({ integration, fetchImpl, now });
  if (prisma?.tenantCRMIntegration?.update) {
    try {
      await prisma.tenantCRMIntegration.update({
        where: { id: integration.id },
        data: { accessToken: encrypt(fresh.accessToken), tokenExpiry: fresh.tokenExpiry }
      });
    } catch (err) {
      console.warn(`[crm] could not persist refreshed Zoho token (integration ${integration.id}): ${err.message}`);
    }
  }
  return fresh;
}

// Single-flight refresh: integration id → the refresh in progress. Leads
// captured together (or a burst of retries) would otherwise each refresh the
// same token at once, and Zoho rate-limits how many access tokens one refresh
// token may mint — with the shared Self-Client token, every tenant draws on
// that one allowance. Per process; each API replica refreshes at most once at a time.
const inflightRefreshes = new Map();

/**
 * A valid access token + the API base URL for an integration, refreshing and
 * persisting when needed. Reuses a still-fresh stored token without a refresh.
 * Concurrent callers for the same integration share one refresh (and one save).
 * @param {object} params
 * @param {object} params.integration a TenantCRMIntegration row
 * @param {object} [params.prisma] used to persist a refreshed token (optional in tests)
 * @param {Function} [params.fetchImpl]
 * @param {number} [params.now]
 * @param {boolean} [params.force] skip the stored token — Zoho just rejected it
 * @returns {Promise<{ accessToken: string, apiDomain: string, refreshed: boolean }>}
 */
async function getAccessToken({ integration, prisma, fetchImpl = fetch, now = Date.now(), force = false }) {
  if (!integration) throw new CrmError('no CRM integration provided', 400);
  const { api } = resolveDomains(integration.region);

  if (!force && tokenIsFresh(integration, now)) {
    const accessToken = safeDecrypt(integration.accessToken);
    if (accessToken) return { accessToken, apiDomain: api, refreshed: false };
  }

  const key = integration.id || null; // no id (an unsaved row): nothing to share safely
  let pending = key ? inflightRefreshes.get(key) : null;
  if (!pending) {
    pending = refreshAndPersist({ integration, prisma, fetchImpl, now });
    if (key) {
      inflightRefreshes.set(key, pending);
      // Cleared whichever way it settles; the .catch only keeps this side
      // chain from being an unhandled rejection — callers still get the error.
      pending.finally(() => inflightRefreshes.delete(key)).catch(() => {});
    }
  }
  const fresh = await pending;
  return { accessToken: fresh.accessToken, apiDomain: fresh.apiDomain, refreshed: true };
}

module.exports = {
  CrmError,
  isZohoConfigured,
  hasServerRefreshToken,
  serverRefreshToken,
  serverRegion,
  resolveDomains,
  normalizeRegion,
  getAccessToken,
  refreshAccessToken,
  authorizeUrl,
  exchangeCode,
  tokenIsFresh,
  DATA_CENTERS,
  DEFAULT_REGION,
  REGIONS: Object.keys(DATA_CENTERS)
};
