const { encrypt, decrypt } = require('../../utils/encryption');
const { logger } = require('../../lib/logger');
const { CrmError } = require('./zohoAuth');

// HubSpot OAuth2 token manager — the HubSpot counterpart of zohoAuth.js. Same
// contract, minus regions (HubSpot has one API host, api.hubapi.com):
//   1. getAccessToken(...) — a usable access token for an integration, refreshing
//      it from the long-lived refresh token when it's expired (or about to), then
//      persisting the new token (AES-256-GCM, like Zoho's) and its expiry.
//   2. exchangeCode / refreshAccessToken — the authorization-code and refresh
//      grants against HubSpot's token endpoint.
//   3. fetchAccountInfo(...) — reads the portal (hub) id from the token so an
//      inbound webhook can be routed back to the tenant.
//
// The OAuth client (HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET) is the platform's
// single registered app; the tokens are per tenant. The HTTP call is injectable
// (fetchImpl) so unit tests never touch the network, and stored tokens are never
// logged or returned to a client. CrmError is reused so the sync + audit-log
// paths treat Zoho and HubSpot failures identically.

const API_BASE = 'https://api.hubapi.com';
const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_PATH = '/oauth/v1/token';
const EXPIRY_SKEW_MS = 60 * 1000; // refresh a little early, never mid-request
const TIMEOUT_MS = 15000;
// Read/write Contacts is enough for the lead sync; notes are attached
// best-effort. Override with HUBSPOT_SCOPE if a portal needs more. HubSpot
// scopes are space-separated.
const DEFAULT_SCOPE = 'crm.objects.contacts.read crm.objects.contacts.write';

const readKey = (name) => String(process.env[name] || '').trim();

/** The platform's HubSpot OAuth app credentials are configured. */
function isHubspotConfigured() {
  return !!(readKey('HUBSPOT_CLIENT_ID') && readKey('HUBSPOT_CLIENT_SECRET'));
}

/** The HubSpot CRM API base URL (single host, unlike Zoho's per-region domains). */
function apiBase() {
  return API_BASE;
}

/**
 * The HubSpot consent URL to send the tenant's browser to. `state` is our signed
 * token binding the flow to a tenant; `redirectUri` must match one registered on
 * the HubSpot app and be identical for authorize and the code exchange.
 */
function authorizeUrl({ redirectUri, state }) {
  const clientId = readKey('HUBSPOT_CLIENT_ID');
  if (!clientId) throw new CrmError('HubSpot OAuth client is not configured', 503);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: readKey('HUBSPOT_SCOPE') || DEFAULT_SCOPE,
    state
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await (body.fetchImpl || fetch)(`${API_BASE}${TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.params.toString(),
      signal: controller.signal
    });
    // A 5xx/429 is worth retrying; a 4xx (bad/revoked token or code) is not.
    if (!res.ok) {
      throw new CrmError(`HubSpot token request failed (${res.status})`, 502,
        { retryable: res.status >= 500 || res.status === 429 });
    }
    const data = await res.json();
    if (!data || !data.access_token) {
      throw new CrmError('HubSpot token response had no access_token', 502);
    }
    return data;
  } catch (err) {
    if (err instanceof CrmError) throw err;
    throw new CrmError(`HubSpot token request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchange the authorization code from the consent redirect for an access +
 * refresh token. Returns both (decrypted) and the expiry.
 */
async function exchangeCode({ code, redirectUri, fetchImpl, now = Date.now() }) {
  const clientId = readKey('HUBSPOT_CLIENT_ID');
  const clientSecret = readKey('HUBSPOT_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new CrmError('HubSpot OAuth client is not configured', 503);
  if (!code) throw new CrmError('missing authorization code', 400);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  });
  const data = await tokenRequest({ params, fetchImpl });
  if (!data.refresh_token) {
    // Without a refresh token we can never renew; surface it rather than store a dead link.
    throw new CrmError('HubSpot did not return a refresh token', 502);
  }
  const expiresInMs = (Number(data.expires_in) || 1800) * 1000;
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    tokenExpiry: new Date(now + expiresInMs)
  };
}

/** Safe decrypt: a corrupt/rotated ciphertext reads as "no token" rather than throwing. */
function safeDecrypt(value) {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

function tokenIsFresh(integration, now) {
  if (!integration.accessToken || !integration.tokenExpiry) return false;
  return new Date(integration.tokenExpiry).getTime() - EXPIRY_SKEW_MS > now;
}

/** Exchange the integration's refresh token for a new access token. */
async function refreshAccessToken({ integration, fetchImpl, now = Date.now() }) {
  const clientId = readKey('HUBSPOT_CLIENT_ID');
  const clientSecret = readKey('HUBSPOT_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new CrmError('HubSpot OAuth client is not configured', 503);

  const refreshToken = safeDecrypt(integration.refreshToken);
  if (!refreshToken) throw new CrmError('no HubSpot refresh token on file for this tenant', 400);

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });
  const data = await tokenRequest({ params, fetchImpl });
  const expiresInMs = (Number(data.expires_in) || 1800) * 1000;
  return { accessToken: String(data.access_token), tokenExpiry: new Date(now + expiresInMs) };
}

// Refresh, then persist (encrypted). Best-effort: a storage failure must not fail
// the sync that triggered the refresh — the token is usable for this call and the
// next call simply refreshes again.
async function refreshAndPersist({ integration, prisma, fetchImpl, now }) {
  const fresh = await refreshAccessToken({ integration, fetchImpl, now });
  if (prisma?.tenantCRMIntegration?.update) {
    try {
      await prisma.tenantCRMIntegration.update({
        where: { id: integration.id },
        data: { accessToken: encrypt(fresh.accessToken), tokenExpiry: fresh.tokenExpiry }
      });
    } catch (err) {
      logger.warn(`[crm] could not persist refreshed HubSpot token (integration ${integration.id}): ${err.message}`);
    }
  }
  return fresh;
}

// Single-flight refresh per integration (see zohoAuth.js for the why): a burst of
// leads must not each mint a new access token from the same refresh token at once.
const inflightRefreshes = new Map();

/**
 * A valid access token + the API base for an integration, refreshing and
 * persisting when needed. Reuses a still-fresh stored token without a refresh.
 * @returns {Promise<{ accessToken: string, apiDomain: string, refreshed: boolean }>}
 */
async function getAccessToken({ integration, prisma, fetchImpl = fetch, now = Date.now(), force = false }) {
  if (!integration) throw new CrmError('no CRM integration provided', 400);

  if (!force && tokenIsFresh(integration, now)) {
    const accessToken = safeDecrypt(integration.accessToken);
    if (accessToken) return { accessToken, apiDomain: API_BASE, refreshed: false };
  }

  const key = integration.id || null;
  let pending = key ? inflightRefreshes.get(key) : null;
  if (!pending) {
    pending = refreshAndPersist({ integration, prisma, fetchImpl, now });
    if (key) {
      inflightRefreshes.set(key, pending);
      pending.finally(() => inflightRefreshes.delete(key)).catch(() => {});
    }
  }
  const fresh = await pending;
  return { accessToken: fresh.accessToken, apiDomain: API_BASE, refreshed: true };
}

/**
 * Read the portal (hub) id and granted scopes for an access token. Used once at
 * connect so inbound webhooks can be mapped to this tenant by portalId.
 * @returns {Promise<{ portalId: string|null, user: string|null, scopes: string[] }>}
 */
async function fetchAccountInfo({ accessToken, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${API_BASE}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
      method: 'GET',
      signal: controller.signal
    });
    if (!res.ok) throw new CrmError(`HubSpot account-info failed (${res.status})`, 502);
    const data = await res.json();
    return {
      portalId: data?.hub_id != null ? String(data.hub_id) : null,
      user: data?.user || null,
      scopes: Array.isArray(data?.scopes) ? data.scopes : []
    };
  } catch (err) {
    if (err instanceof CrmError) throw err;
    throw new CrmError(`HubSpot account-info request failed: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  CrmError,
  isHubspotConfigured,
  apiBase,
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  getAccessToken,
  fetchAccountInfo,
  tokenIsFresh,
  API_BASE,
  DEFAULT_SCOPE
};
