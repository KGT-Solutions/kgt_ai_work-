const defaultPrisma = require('../../lib/prisma');
const { encrypt } = require('../../utils/encryption');
const { validRegion, supportedRegions } = require('../crm/crmSettings');
const {
  HelpdeskError, isZohoDeskConfigured, verifyFreshdesk, verifyZohoDesk, freshdeskBase
} = require('./helpdeskClient');

// The dashboard's Helpdesk card (Integrations page) talks to this service. It
// owns connecting/disconnecting a tenant's Zoho Desk or Freshdesk account and
// reporting status. Credentials go in encrypted (AES-256-GCM, utils/encryption.js)
// and are NEVER returned to the browser. Connecting verifies the credentials
// first, so "Connected" always means a link that actually works.

const PROVIDERS = ['zoho_desk', 'freshdesk'];
const RECENT_LOG_LIMIT = 10;
const LOG_FIELDS = { id: true, provider: true, operation: true, status: true, externalTicketId: true, error: true, createdAt: true };

class HelpdeskConfigError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'HelpdeskConfigError';
    this.statusCode = statusCode;
  }
}

/**
 * Connection status + recent activity. Never exposes a key or token; `connected`
 * means a verified, credential-bearing link is on file.
 */
async function getHelpdeskStatus(tenantId, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantHelpdeskIntegration.findUnique({ where: { tenantId } }).catch(() => null);
  let recentLogs = [];
  try {
    recentLogs = await prisma.helpdeskSyncLog.findMany({
      where: { tenantId }, orderBy: { createdAt: 'desc' }, take: RECENT_LOG_LIMIT, select: LOG_FIELDS
    });
  } catch { /* table empty/unavailable — status still renders */ }

  return {
    providers: PROVIDERS,
    regions: supportedRegions(),
    zohoDeskConfigured: isZohoDeskConfigured(), // the platform Zoho app is set up
    connected: !!row,
    provider: row?.provider || null,
    isEnabled: row ? row.isEnabled : false,
    freshdeskDomain: row?.freshdeskDomain || null,
    region: row?.region || null,
    orgId: row?.orgId || null,
    departmentId: row?.departmentId || null,
    connectedAt: row?.updatedAt || null,
    recentLogs
  };
}

/**
 * Connect (or re-connect) a tenant's helpdesk. Verifies the credentials against
 * the provider, then stores them with every secret encrypted. One helpdesk per
 * tenant: connecting a new provider replaces the old row's fields.
 * @returns {Promise<{ connected: true, provider: string }>}
 */
async function connectHelpdesk(tenantId, input = {}, { prisma = defaultPrisma, fetchImpl = fetch } = {}) {
  const provider = String(input.provider || '').trim().toLowerCase();
  if (!PROVIDERS.includes(provider)) throw new HelpdeskConfigError(`provider must be one of: ${PROVIDERS.join(', ')}`);

  let data;
  if (provider === 'freshdesk') {
    const apiKey = String(input.apiKey || '').trim();
    const domainRaw = String(input.freshdeskDomain || '').trim();
    if (!domainRaw) throw new HelpdeskConfigError('A Freshdesk domain is required');
    if (!apiKey) throw new HelpdeskConfigError('A Freshdesk API key is required');
    freshdeskBase(domainRaw); // validates the domain shape (throws HelpdeskError on a bad host)
    try {
      await verifyFreshdesk({ domain: domainRaw, apiKey, fetchImpl });
    } catch (err) {
      throw new HelpdeskConfigError(`Could not verify the Freshdesk credentials: ${err.message}`, err.statusCode || 502);
    }
    data = {
      provider, isEnabled: true, freshdeskDomain: domainRaw, apiKey: encrypt(apiKey),
      // clear any previous Zoho Desk link
      region: null, orgId: null, departmentId: null, refreshToken: null, accessToken: null, tokenExpiry: null
    };
  } else {
    if (!isZohoDeskConfigured()) throw new HelpdeskConfigError('Zoho Desk is not configured on this server yet.', 503);
    const region = validRegion(input.region);
    if (!region) throw new HelpdeskConfigError(`Unsupported region. Choose one of: ${supportedRegions().join(', ')}`);
    const orgId = String(input.orgId || '').trim();
    const departmentId = String(input.departmentId || '').trim();
    const refreshToken = String(input.refreshToken || '').trim();
    if (!orgId) throw new HelpdeskConfigError('A Zoho Desk org id is required');
    if (!departmentId) throw new HelpdeskConfigError('A Zoho Desk department id is required');
    if (!refreshToken) throw new HelpdeskConfigError('A Zoho Desk refresh token is required');
    const encryptedRefresh = encrypt(refreshToken);
    try {
      // verify works on the same (encrypted) shape the row will hold.
      await verifyZohoDesk({ integration: { region, orgId, refreshToken: encryptedRefresh }, fetchImpl });
    } catch (err) {
      throw new HelpdeskConfigError(`Could not verify the Zoho Desk credentials: ${err.message}`, err.statusCode || 502);
    }
    data = {
      provider, isEnabled: true, region, orgId, departmentId, refreshToken: encryptedRefresh, accessToken: null, tokenExpiry: null,
      // clear any previous Freshdesk link
      freshdeskDomain: null, apiKey: null
    };
  }

  await prisma.tenantHelpdeskIntegration.upsert({
    where: { tenantId }, update: data, create: { tenantId, ...data }
  });
  return { connected: true, provider };
}

/** Turn ticket mirroring on/off without disconnecting. */
async function setHelpdeskEnabled(tenantId, isEnabled, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantHelpdeskIntegration.findUnique({ where: { tenantId } });
  if (!row) throw new HelpdeskConfigError('No helpdesk is connected.', 404);
  await prisma.tenantHelpdeskIntegration.update({ where: { tenantId }, data: { isEnabled: !!isEnabled } });
  return { isEnabled: !!isEnabled };
}

/** Remove a tenant's helpdesk connection entirely. Idempotent. */
async function disconnectHelpdesk(tenantId, { prisma = defaultPrisma } = {}) {
  await prisma.tenantHelpdeskIntegration.deleteMany({ where: { tenantId } });
  return { connected: false };
}

module.exports = {
  HelpdeskConfigError,
  PROVIDERS,
  getHelpdeskStatus,
  connectHelpdesk,
  setHelpdeskEnabled,
  disconnectHelpdesk
};
