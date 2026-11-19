const defaultPrisma = require('../../lib/prisma');
const { encrypt } = require('../../utils/encryption');
const { signToken, verifyToken } = require('../../utils/authTokens');
const {
  CrmError, isZohoConfigured, hasServerRefreshToken, serverRefreshToken, serverRegion,
  normalizeRegion, authorizeUrl, exchangeCode, getAccessToken, resolveDomains, REGIONS
} = require('./zohoAuth');
const { crmSyncEnabled } = require('./zohoSync');

// The dashboard's CRM Integrations page talks to this service through the
// workspace router. It owns connecting/disconnecting a tenant's Zoho account
// and reporting status — tokens in, tokens out, all encrypted, none ever
// returned to the browser. The OAuth code exchange and state signing are here
// so the routes stay thin and this logic is unit-testable with a fake prisma.

const RECENT_LOG_LIMIT = 10;
const LOG_FIELDS = { id: true, operation: true, direction: true, status: true, crmRecordId: true, error: true, createdAt: true };

/** The supported Zoho data-centre regions, for the dashboard's selector. */
function supportedRegions() {
  return REGIONS.slice();
}

function validRegion(region) {
  const r = String(region || '').trim().toLowerCase().replace(/^\./, '');
  return REGIONS.includes(r) ? r : null;
}

/**
 * Connection status + recent sync activity for a tenant. Never exposes tokens;
 * `connected` means a usable (refresh-token-bearing) Zoho link is on file.
 */
async function getCrmStatus(tenantId, { prisma = defaultPrisma } = {}) {
  const integration = await prisma.tenantCRMIntegration.findUnique({ where: { tenantId } }).catch(() => null);
  let recentLogs = [];
  try {
    recentLogs = await prisma.cRMSyncLog.findMany({
      where: { tenantId }, orderBy: { createdAt: 'desc' }, take: RECENT_LOG_LIMIT, select: LOG_FIELDS
    });
  } catch { /* table may be empty / unavailable — status still renders */ }

  const serverManaged = hasServerRefreshToken();
  return {
    provider: 'ZOHO',
    configured: isZohoConfigured(), // the platform OAuth app is set up
    // The server has a ready refresh token (Self Client): the tenant connects
    // in one click, with the region fixed by that server configuration.
    serverManaged,
    serverRegion: serverManaged ? serverRegion() : null,
    syncEnabled: crmSyncEnabled(),  // outbound sync flag is on
    connected: !!(integration && integration.refreshToken),
    isEnabled: integration ? integration.isEnabled : false,
    region: integration?.region || (serverManaged ? serverRegion() : 'in'),
    regions: supportedRegions(),
    tokenExpiry: integration?.tokenExpiry || null,
    connectedAt: integration?.updatedAt || null,
    recentLogs
  };
}

/**
 * Start the OAuth flow: remember the chosen region and hand back the Zoho
 * consent URL for the browser to open. A signed `state` binds the eventual
 * callback to this tenant + region.
 * @returns {Promise<{ authUrl: string }>}
 */
async function beginConnect({ tenantId, region, redirectUri }, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  if (!isZohoConfigured()) throw new CrmError('Zoho is not configured on this server yet.', 503);

  // Self Client setup: adopt the server's refresh token directly, no redirect.
  if (hasServerRefreshToken()) {
    return connectWithServerToken({ tenantId }, deps);
  }

  const r = validRegion(region);
  if (!r) throw new CrmError(`Unsupported region. Choose one of: ${REGIONS.join(', ')}`, 400);

  // Store the region now (tokens are written only once consent succeeds), so a
  // reload of the page before the redirect still shows the right region.
  await prisma.tenantCRMIntegration.upsert({
    where: { tenantId },
    update: { region: r, provider: 'ZOHO' },
    create: { tenantId, region: r, provider: 'ZOHO', isEnabled: true, fieldMapping: {} }
  });

  const state = signToken('crm_oauth', { tenantId, region: r });
  return { authUrl: authorizeUrl({ region: r, redirectUri, state }) };
}

/**
 * Connect using the server-wide refresh token (Self Client). Stores it
 * encrypted for the tenant at the server's region, then validates it by
 * minting an access token — so "Connected" always means a working link.
 * Rolls back if the token can't be exchanged.
 */
async function connectWithServerToken({ tenantId }, { prisma = defaultPrisma, fetchImpl } = {}) {
  const region = serverRegion();
  const integration = await prisma.tenantCRMIntegration.upsert({
    where: { tenantId },
    update: { region, provider: 'ZOHO', isEnabled: true, refreshToken: encrypt(serverRefreshToken()), accessToken: null, tokenExpiry: null },
    create: { tenantId, region, provider: 'ZOHO', isEnabled: true, fieldMapping: {}, refreshToken: encrypt(serverRefreshToken()), accessToken: null, tokenExpiry: null }
  });

  try {
    await getAccessToken({ integration, prisma, fetchImpl });
  } catch (err) {
    await prisma.tenantCRMIntegration.deleteMany({ where: { tenantId } }).catch(() => {});
    throw new CrmError(`Could not verify the Zoho connection: ${err.message}`, err.statusCode || 502);
  }
  return { connected: true, region };
}

/**
 * Finish the OAuth flow from the callback: verify state, exchange the code and
 * store the encrypted tokens. Returns the tenant id so the callback can log it.
 * @returns {Promise<{ tenantId: string, region: string }>}
 */
async function completeConnect({ state, code, redirectUri }, { prisma = defaultPrisma, fetchImpl } = {}) {
  const claims = verifyToken(state, 'crm_oauth');
  if (!claims) throw new CrmError('The connection link expired or is invalid. Start again from the dashboard.', 400);
  const { tenantId } = claims;
  const region = validRegion(claims.region) || 'com';

  const tokens = await exchangeCode({ code, region, redirectUri, fetchImpl });

  await prisma.tenantCRMIntegration.upsert({
    where: { tenantId },
    update: {
      region, provider: 'ZOHO', isEnabled: true,
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      tokenExpiry: tokens.tokenExpiry
    },
    create: {
      tenantId, region, provider: 'ZOHO', isEnabled: true, fieldMapping: {},
      accessToken: encrypt(tokens.accessToken),
      refreshToken: encrypt(tokens.refreshToken),
      tokenExpiry: tokens.tokenExpiry
    }
  });
  return { tenantId, region };
}

/** Remove a tenant's CRM connection entirely. Idempotent. */
async function disconnect(tenantId, { prisma = defaultPrisma } = {}) {
  await prisma.tenantCRMIntegration.deleteMany({ where: { tenantId } });
  return { connected: false };
}

module.exports = {
  getCrmStatus,
  beginConnect,
  completeConnect,
  disconnect,
  supportedRegions,
  validRegion,
  resolveDomains
};
