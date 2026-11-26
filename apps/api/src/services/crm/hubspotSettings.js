const defaultPrisma = require('../../lib/prisma');
const { logger } = require('../../lib/logger');
const { encrypt } = require('../../utils/encryption');
const { signToken, verifyToken } = require('../../utils/authTokens');
const {
  CrmError, isHubspotConfigured, authorizeUrl, exchangeCode, getAccessToken, fetchAccountInfo
} = require('./hubspotAuth');
const { crmSyncEnabled } = require('./zohoSync');

// The dashboard's HubSpot CRM section talks to this service through the workspace
// router — the HubSpot counterpart of crmSettings.js. It owns connecting /
// disconnecting a tenant's HubSpot account and reporting status; tokens in, tokens
// out, all encrypted, none ever returned to the browser. There is ONE CRM slot
// per tenant (TenantCRMIntegration.tenantId is unique), so connecting HubSpot is
// refused while Zoho is connected (and vice-versa) — the UI says to disconnect
// the other first.

const RECENT_LOG_LIMIT = 10;
const LOG_FIELDS = { id: true, operation: true, direction: true, status: true, crmRecordId: true, error: true, createdAt: true };

/**
 * Connection status + recent sync activity for a tenant's HubSpot link. Never
 * exposes tokens; `connected` means a usable (refresh-token-bearing) HubSpot
 * integration is on file. `blockedBy` names another CRM that holds the single
 * per-tenant slot, so the UI can explain why connecting is disabled.
 */
async function getHubspotStatus(tenantId, { prisma = defaultPrisma } = {}) {
  const integration = await prisma.tenantCRMIntegration.findUnique({ where: { tenantId } }).catch(() => null);
  const isHubspot = integration && integration.provider === 'HUBSPOT';

  let recentLogs = [];
  try {
    recentLogs = await prisma.cRMSyncLog.findMany({
      where: { tenantId, provider: 'HUBSPOT' },
      orderBy: { createdAt: 'desc' }, take: RECENT_LOG_LIMIT, select: LOG_FIELDS
    });
  } catch { /* table may be empty / unavailable — status still renders */ }

  return {
    provider: 'HUBSPOT',
    configured: isHubspotConfigured(),        // the platform OAuth app is set up
    syncEnabled: crmSyncEnabled(),            // outbound sync flag is on
    connected: !!(isHubspot && integration.refreshToken),
    isEnabled: isHubspot ? integration.isEnabled : false,
    portalId: isHubspot ? integration.portalId || null : null,
    tokenExpiry: isHubspot ? integration.tokenExpiry || null : null,
    connectedAt: isHubspot ? integration.updatedAt || null : null,
    // Another CRM occupies the single per-tenant slot.
    blockedBy: integration && !isHubspot ? integration.provider : null,
    recentLogs
  };
}

/**
 * Start the OAuth flow: hand back the HubSpot consent URL for the browser to
 * open. A signed `state` binds the eventual callback to this tenant.
 * @returns {Promise<{ authUrl: string }>}
 */
async function beginConnect({ tenantId, redirectUri }, { prisma = defaultPrisma } = {}) {
  if (!isHubspotConfigured()) throw new CrmError('HubSpot is not configured on this server yet.', 503);

  // One CRM per tenant: refuse if a different provider already holds the slot.
  const existing = await prisma.tenantCRMIntegration.findUnique({ where: { tenantId } }).catch(() => null);
  if (existing && existing.provider !== 'HUBSPOT') {
    throw new CrmError(`Disconnect ${existing.provider} first — a workspace can connect one CRM at a time.`, 409);
  }

  const state = signToken('hubspot_oauth', { tenantId });
  return { authUrl: authorizeUrl({ redirectUri, state }) };
}

/**
 * Finish the OAuth flow from the callback: verify state, exchange the code, read
 * the portal id and store the encrypted tokens. Returns the tenant id so the
 * callback can log it. Rolls nothing back on a portal-info hiccup — the portal id
 * is best-effort and the connection is still usable without it.
 * @returns {Promise<{ tenantId: string, portalId: string|null }>}
 */
async function completeConnect({ state, code, redirectUri }, { prisma = defaultPrisma, fetchImpl } = {}) {
  const claims = verifyToken(state, 'hubspot_oauth');
  if (!claims) throw new CrmError('The connection link expired or is invalid. Start again from the dashboard.', 400);
  const { tenantId } = claims;

  // Guard the single CRM slot again at completion (state could outlive a Zoho connect).
  const existing = await prisma.tenantCRMIntegration.findUnique({ where: { tenantId } }).catch(() => null);
  if (existing && existing.provider !== 'HUBSPOT') {
    throw new CrmError(`Disconnect ${existing.provider} first — a workspace can connect one CRM at a time.`, 409);
  }

  const tokens = await exchangeCode({ code, redirectUri, fetchImpl });

  let portalId = null;
  try {
    ({ portalId } = await fetchAccountInfo({ accessToken: tokens.accessToken, fetchImpl }));
  } catch (err) {
    logger.warn(`[crm] could not read HubSpot portal id at connect (tenant ${tenantId}): ${err.message}`);
  }

  await prisma.tenantCRMIntegration.upsert({
    where: { tenantId },
    update: {
      provider: 'HUBSPOT', isEnabled: true, portalId,
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      tokenExpiry: tokens.tokenExpiry
    },
    create: {
      tenantId, provider: 'HUBSPOT', isEnabled: true, portalId, fieldMapping: {},
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      tokenExpiry: tokens.tokenExpiry
    }
  });
  return { tenantId, portalId };
}

/** Remove a tenant's HubSpot connection. Idempotent; never touches a Zoho link. */
async function disconnect(tenantId, { prisma = defaultPrisma } = {}) {
  await prisma.tenantCRMIntegration.deleteMany({ where: { tenantId, provider: 'HUBSPOT' } });
  return { connected: false };
}

/**
 * Resolve a HubSpot portalId to its tenant id (for inbound webhooks). Returns
 * null when no tenant has that portal connected. Never throws.
 */
async function tenantIdForPortal(portalId, { prisma = defaultPrisma } = {}) {
  if (!portalId) return null;
  try {
    const row = await prisma.tenantCRMIntegration.findFirst({
      where: { provider: 'HUBSPOT', portalId: String(portalId) }, select: { tenantId: true }
    });
    return row?.tenantId || null;
  } catch {
    return null;
  }
}

module.exports = {
  getHubspotStatus,
  beginConnect,
  completeConnect,
  disconnect,
  tenantIdForPortal,
  getAccessToken
};
