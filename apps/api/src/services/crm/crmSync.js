const defaultPrisma = require('../../lib/prisma');
const { logger } = require('../../lib/logger');
const { crmSyncEnabled } = require('./zohoSync');

// Provider dispatcher for the outbound lead sync. services/leads.js calls this
// once per new lead; it looks at which CRM the tenant has connected and routes to
// the matching sync (Zoho or HubSpot). Both targets are resilient and
// fire-and-forget on their own — this layer only picks one and never throws, so
// a broken CRM can't affect lead capture or the chat reply.
//
// The per-provider modules are required lazily to avoid a load-time cycle
// (leads → crmSync → zohoSync/hubspotSync → prisma) and so neither provider's
// module loads unless it's actually used.

/**
 * @param {{ tenant: {id, slug?}, lead: object, summary?: string|null, extra?: object }} args
 * @param {object} [deps] { prisma, fetchImpl, getToken, now } — forwarded for tests
 * @returns {Promise<object>} a result describing what happened (never rejects)
 */
async function syncLeadToCrm(args, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;

  // Globally inert until outbound sync is switched on — matches each provider's
  // own guard, and saves a DB lookup when the whole feature is off.
  if (!crmSyncEnabled()) return { skipped: 'disabled' };

  let provider;
  try {
    const integration = await prisma.tenantCRMIntegration.findUnique({
      where: { tenantId: args.tenant.id },
      select: { provider: true }
    });
    if (!integration) return { skipped: 'no-integration' };
    provider = integration.provider;
  } catch (err) {
    logger.error(`[crm] dispatcher could not load integration for tenant ${args.tenant?.slug || args.tenant?.id}: ${err.message}`);
    return { skipped: 'lookup-failed' };
  }

  if (provider === 'HUBSPOT') return require('./hubspotSync').syncLeadToCrm(args, deps);
  // ZOHO (the default) and anything else: the Zoho sync, unchanged. It re-checks
  // the provider and no-ops on a mismatch, so this stays safe either way.
  return require('./zohoSync').syncLeadToCrm(args, deps);
}

module.exports = { syncLeadToCrm };
