const defaultPrisma = require('../../lib/prisma');
const { logger } = require('../../lib/logger');
const { CrmError, getAccessToken, isHubspotConfigured } = require('./hubspotAuth');
// Reuse the provider-agnostic pieces of the Zoho sync so both CRMs retry, back
// off and shape their audit logs identically. Only the HTTP calls, field names
// and status vocabulary differ between HubSpot and Zoho.
const { withRetry, conversationLink, crmSyncEnabled } = require('./zohoSync');

// Resilient, bi-directional HubSpot CRM sync — the HubSpot counterpart of
// zohoSync.js. Everything here fails safely: a HubSpot outage, rate limit or bad
// token must never crash Express or block a chat turn. Outbound work (contact
// upsert + note) runs fire-and-forget from services/leads.js via the dispatcher
// (services/crm/crmSync.js); inbound work is the webhook (routes/crmWebhook).
//
//   OUTBOUND  syncLeadToCrm → batch/upsert a Contact deduped by email
//             (lifecyclestage=lead, source via note) → attach a Note with the AI
//             chat summary + a dashboard link → mirror the contact id back onto
//             the Lead row. Every step is audited in CRMSyncLog (provider HUBSPOT).
//   INBOUND   applyInboundStatus maps a HubSpot hs_lead_status / lifecyclestage
//             change back to our two-state LeadStatus and updates the lead.
//
// The HTTP call and the token lookup are injectable so unit tests never hit the
// network or the database.

const API_PREFIX = '/crm/v3';
const LEAD_SOURCE = () => String(process.env.HUBSPOT_LEAD_SOURCE || 'KGT Orb website').trim();
const TIMEOUT_MS = 15000;
// note→contact association type (HubSpot defined). See HubSpot associations v4.
const NOTE_TO_CONTACT_TYPE_ID = Number(process.env.HUBSPOT_NOTE_ASSOCIATION_TYPE_ID || 202);
// HubSpot codes/categories for "this access token is not valid", whatever the HTTP status.
const AUTH_FAILURE_CATEGORIES = new Set(['EXPIRED_AUTHENTICATION', 'INVALID_AUTHENTICATION']);

// ── HubSpot status vocabulary → our two-state LeadStatus. A rep engaging the
// contact in any way means CONTACTED here; an untouched contact is NEW. An
// unrecognised value returns null = leave the row unchanged, so a custom
// pipeline value can never silently reset a lead.
const LIFECYCLE_NEW = new Set(['subscriber', 'lead']);
const LIFECYCLE_CONTACTED = new Set([
  'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer', 'evangelist'
]);
const LEADSTATUS_NEW = new Set(['new', 'open']);
const LEADSTATUS_CONTACTED = new Set([
  'in_progress', 'open_deal', 'unqualified', 'attempted_to_contact', 'connected', 'bad_timing'
]);

/**
 * Map a HubSpot contact change back to NEW / CONTACTED / null.
 * @param {string} propertyName  'hs_lead_status' | 'lifecyclestage'
 * @param {string} value         the new value
 */
function mapHubspotStatus(propertyName, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  const prop = String(propertyName || '').trim().toLowerCase();
  if (prop === 'lifecyclestage') {
    if (LIFECYCLE_NEW.has(v)) return 'NEW';
    if (LIFECYCLE_CONTACTED.has(v)) return 'CONTACTED';
    return null;
  }
  // default: treat as hs_lead_status
  if (LEADSTATUS_NEW.has(v)) return 'NEW';
  if (LEADSTATUS_CONTACTED.has(v)) return 'CONTACTED';
  return null;
}

const safeError = (err) => ({ message: String(err?.message || err), statusCode: err?.statusCode });

/**
 * One authenticated HubSpot CRM request. Returns { status, data }. Maps 429/5xx
 * and network/timeout failures to retryable CrmErrors; a 401 (or an auth
 * category) is flagged authFailure so the caller mints a fresh token.
 */
async function hubRequest({ method, apiDomain, token, path, body, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${apiDomain}${API_PREFIX}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    if (res.status === 204) return { status: 204, data: null };
    if (res.status === 429 || res.status >= 500) {
      throw new CrmError(`HubSpot ${method} ${path} failed (${res.status})`, 502, { retryable: true });
    }
    let data = null;
    try { data = await res.json(); } catch { /* some endpoints return no body */ }
    if (res.status >= 400) {
      // HubSpot's own category (e.g. VALIDATION_ERROR, EXPIRED_AUTHENTICATION) —
      // safe to surface; never the raw body, which can echo request data.
      const category = data?.category;
      const authFailure = res.status === 401 || AUTH_FAILURE_CATEGORIES.has(category);
      throw new CrmError(`HubSpot ${method} ${path} rejected (${res.status}${category ? `, ${category}` : ''})`, 502, { authFailure });
    }
    return { status: res.status, data };
  } catch (err) {
    if (err instanceof CrmError) throw err;
    throw new CrmError(`HubSpot ${method} ${path} request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// KGT→HubSpot contact property map, honouring the tenant's editable fieldMapping.
const fieldMap = (fieldMapping = {}) => ({ email: 'email', phone: 'phone', name: 'firstname', ...fieldMapping });

/** Build the HubSpot contact properties for an upsert. */
function contactProperties({ lead, fieldMapping = {}, extra = {} }) {
  const map = fieldMap(fieldMapping);
  const props = {};
  if (lead.email) props[map.email] = lead.email;
  if (extra.phone) props[map.phone] = extra.phone;
  // A friendly name for the contact; fall back to the email's local part.
  const name = extra.name || (lead.email ? lead.email.split('@')[0] : 'Website Visitor');
  props[map.name] = name;
  // Place the contact at the lead stage; the source is recorded in the note,
  // since HubSpot's analytics-source property is read-only.
  props.lifecyclestage = 'lead';
  return props;
}

/**
 * Create-or-update a contact in ONE atomic HubSpot call, deduped by email.
 * POST /crm/v3/objects/contacts/batch/upsert lets HubSpot match an existing
 * contact on the email id-property — the analogue of Zoho's /Leads/upsert.
 * @returns {Promise<{ crmRecordId: string, created: boolean }>}
 */
async function upsertContactRecord({ apiDomain, token, email, properties, fetchImpl }) {
  if (!email) throw new CrmError('HubSpot contact upsert needs an email', 400);
  const { data } = await hubRequest({
    method: 'POST', apiDomain, token, fetchImpl,
    path: '/objects/contacts/batch/upsert',
    body: { inputs: [{ idProperty: 'email', id: String(email), properties }] }
  });
  const row = data?.results?.[0];
  if (!row || !row.id) {
    throw new CrmError('HubSpot contact upsert did not return an id', 502);
  }
  // HubSpot flags a freshly inserted record with `new: true` on the batch result.
  return { crmRecordId: String(row.id), created: row.new === true };
}

/** Attach a Note (AI summary + dashboard link) to a contact. Best-effort. */
async function attachNote({ apiDomain, token, recordId, content, now = Date.now(), fetchImpl }) {
  await hubRequest({
    method: 'POST', apiDomain, token, fetchImpl, path: '/objects/notes',
    body: {
      properties: { hs_note_body: content, hs_timestamp: new Date(now).toISOString() },
      associations: [{
        to: { id: String(recordId) },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT_TYPE_ID }]
      }]
    }
  });
}

/**
 * Upsert (atomic, deduped by email) → note. Pure of persistence so it's easy to
 * unit test; syncLeadToCrm wraps it with retry, logging and DB mirroring.
 * @returns {Promise<{ crmRecordId: string, created: boolean }>}
 */
async function upsertLead({ apiDomain, token, lead, summary, sessionId, fieldMapping, extra = {}, now = Date.now(), fetchImpl }) {
  const properties = contactProperties({ lead, fieldMapping, extra });
  const { crmRecordId, created } = await upsertContactRecord({ apiDomain, token, email: lead.email, properties, fetchImpl });

  const link = conversationLink(sessionId || lead.sessionId);
  const body = [
    summary || 'A visitor engaged with the KGT Orb assistant and left their contact details.',
    `\n\nSource: ${LEAD_SOURCE()}`,
    link ? `\nConversation: ${link}` : ''
  ].join('');
  // The note is value-add, not the point of the sync: don't fail an upsert if
  // only the note call errors (e.g. the portal didn't grant the notes scope).
  try {
    await attachNote({ apiDomain, token, recordId: crmRecordId, content: body, now, fetchImpl });
  } catch (err) {
    logger.warn(`[crm] note attach failed for HubSpot contact ${crmRecordId}: ${err.message}`);
  }
  return { crmRecordId, created };
}

/**
 * Mirror a captured lead into the tenant's HubSpot CRM. Never throws: it is
 * started fire-and-forget from the chat path, so every failure is caught,
 * audited in CRMSyncLog and logged. No-op unless CRM_SYNC_ENABLED and the tenant
 * has an enabled HubSpot integration. Mirrors zohoSync.syncLeadToCrm exactly.
 * @returns {Promise<object>} a result describing what happened (never rejects)
 */
async function syncLeadToCrm({ tenant, lead, summary = null, extra = {} }, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const fetchImpl = deps.fetchImpl || fetch;
  const getToken = deps.getToken || getAccessToken;
  const now = deps.now || Date.now();

  if (!crmSyncEnabled()) return { skipped: 'disabled' };
  if (!isHubspotConfigured()) return { skipped: 'unconfigured' };

  let integration;
  try {
    integration = await prisma.tenantCRMIntegration.findUnique({ where: { tenantId: tenant.id } });
  } catch (err) {
    logger.error(`[crm] could not load integration for tenant ${tenant.slug || tenant.id}: ${err.message}`);
    return { skipped: 'lookup-failed' };
  }
  if (!integration || !integration.isEnabled) return { skipped: 'no-integration' };
  if (integration.provider !== 'HUBSPOT') return { skipped: `provider-${integration.provider}` };

  const logId = await createSyncLog(prisma, {
    tenantId: tenant.id, integrationId: integration.id, leadId: lead.id, operation: 'lead.upsert'
  });

  try {
    let { accessToken, apiDomain } = await getToken({ integration, prisma, fetchImpl, now });
    let attempts = 0;
    const attempt = () => withRetry(
      () => upsertLead({
        apiDomain, token: accessToken, lead, summary, sessionId: lead.sessionId,
        fieldMapping: integration.fieldMapping || {}, extra, now, fetchImpl
      }),
      (n, err) => { attempts += 1; logger.warn(`[crm] lead ${lead.id} HubSpot sync retry ${n}: ${err.message}`); }
    );
    let outcome;
    try {
      outcome = await attempt();
    } catch (err) {
      if (!err?.authFailure) throw err;
      // The stored token looked fresh but HubSpot rejected it. Mint a new one and
      // retry once; a second rejection means the connection itself is broken.
      logger.warn(`[crm] lead ${lead.id}: HubSpot rejected the access token — refreshing it and retrying once`);
      ({ accessToken, apiDomain } = await getToken({ integration, prisma, fetchImpl, now, force: true }));
      attempts += 1;
      outcome = await attempt();
    }
    const { crmRecordId, created } = outcome;

    // Mirror the CRM id back so an inbound status webhook can find this lead.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { crmProvider: 'HUBSPOT', crmRecordId, crmSyncedAt: new Date(now) }
    }).catch((err) => logger.warn(`[crm] could not mirror CRM id onto lead ${lead.id}: ${err.message}`));

    await updateSyncLog(prisma, logId, { status: 'SUCCESS', crmRecordId, attempts });
    logger.info(`[crm] lead ${lead.id} ${created ? 'created in' : 'updated in'} HubSpot as ${crmRecordId} (tenant ${tenant.slug || tenant.id})`);
    return { synced: true, crmRecordId, created };
  } catch (err) {
    await updateSyncLog(prisma, logId, { status: 'FAILED', error: safeError(err) });
    logger.error(`[crm] ERROR: lead ${lead.id} HubSpot sync FAILED (tenant ${tenant.slug || tenant.id}): ${err.message}`);
    return { synced: false, error: err.message };
  }
}

/**
 * Apply an inbound HubSpot status change to the matching Lead. Identity is the
 * (crmProvider, crmRecordId) compound key — scoped to the tenant hint resolved
 * from the event's portalId. The email fallback is TENANT-SCOPED ONLY. An
 * unmapped record id is reported, never applied to an arbitrary row. Never throws.
 * Mirrors zohoSync.applyInboundStatus.
 * @returns {Promise<{ updated: boolean, reason?: string, leadId?: string, status?: string, tenantId?: string }>}
 */
async function applyInboundStatus({ recordId, propertyName, value, tenantId = null, email = null }, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const now = deps.now ? new Date(deps.now) : new Date();

  const status = mapHubspotStatus(propertyName, value);
  if (!status) return { updated: false, reason: 'unmapped-status' };

  try {
    const tenantScope = tenantId ? { tenantId } : {};
    let lead = recordId
      ? await prisma.lead.findFirst({ where: { ...tenantScope, crmProvider: 'HUBSPOT', crmRecordId: String(recordId) } })
      : null;

    if (!lead && email) {
      if (!tenantId) return { updated: false, reason: 'email-match-needs-tenant' };
      lead = await prisma.lead.findFirst({
        where: { tenantId, email: String(email).toLowerCase() },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!lead) return { updated: false, reason: recordId ? 'unmapped-record' : 'lead-not-found' };

    const changed = lead.status !== status;
    if (changed) await prisma.lead.update({ where: { id: lead.id }, data: { status } });
    await createSyncLog(prisma, {
      tenantId: lead.tenantId, leadId: lead.id, operation: 'webhook.status',
      direction: 'inbound', status: 'SUCCESS', crmRecordId: recordId ? String(recordId) : null
    });
    return { updated: changed, leadId: lead.id, status, tenantId: lead.tenantId };
  } catch (err) {
    logger.error(`[crm] ERROR: inbound HubSpot status update FAILED (record ${recordId}): ${err.message}`);
    return { updated: false, reason: 'exception' };
  }
}

// ── CRMSyncLog helpers (provider HUBSPOT). Best-effort: an audit row must never
// be what breaks a sync, so a logging failure is swallowed (and returns null).
async function createSyncLog(prisma, { tenantId, integrationId = null, leadId = null, operation, direction = 'outbound', status = 'PENDING', crmRecordId = null }) {
  try {
    const row = await prisma.cRMSyncLog.create({
      data: { tenantId, integrationId, leadId, provider: 'HUBSPOT', operation, direction, status, crmRecordId }
    });
    return row.id;
  } catch {
    return null;
  }
}

async function updateSyncLog(prisma, id, data) {
  if (!id) return;
  try {
    await prisma.cRMSyncLog.update({ where: { id }, data });
  } catch { /* audit is best-effort */ }
}

module.exports = {
  syncLeadToCrm,
  applyInboundStatus,
  upsertLead,
  upsertContactRecord,
  attachNote,
  contactProperties,
  mapHubspotStatus,
  hubRequest,
  API_PREFIX
};
