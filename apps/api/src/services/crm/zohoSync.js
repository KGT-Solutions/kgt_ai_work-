const defaultPrisma = require('../../lib/prisma');
const { CrmError, getAccessToken, isZohoConfigured } = require('./zohoAuth');

// Resilient, bi-directional Zoho CRM sync. Everything here is designed to fail
// safely: a Zoho outage, rate limit or bad token must never crash Express or
// block a chat turn. Outbound work (lead upsert + note) runs fire-and-forget
// from services/leads.js; inbound work is the webhook (routes/crmWebhook).
//
//   OUTBOUND  syncLeadToCrm → dedupe (search by email/phone) → create or
//             update the lead (source "KGT Orb website") → attach a Note with
//             the AI chat summary + a dashboard link → mirror the CRM id back
//             onto the Lead row. Every step is audited in CRMSyncLog.
//   INBOUND   applyInboundStatus maps a Zoho Lead_Status change back to our
//             two-state LeadStatus and updates the matching Lead.
//
// The HTTP call and the token lookup are injectable so unit tests never hit
// the network or the database.

const API_VERSION = () => String(process.env.ZOHO_API_VERSION || 'v2').trim();
const LEAD_SOURCE = () => String(process.env.ZOHO_LEAD_SOURCE || 'KGT Orb website').trim();
const TIMEOUT_MS = 15000;
// Exponential-ish backoff for transient failures (rate limits, 5xx, timeouts),
// matching the retry shape used for lead emails (services/leads.js).
const RETRY_DELAYS_MS = String(process.env.CRM_SYNC_RETRY_DELAYS_MS || '1000,5000,15000')
  .split(',').map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);

const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });
// Zoho's codes for "this access token is not valid", whatever the HTTP status.
// (Not OAUTH_SCOPE_MISMATCH: a new token carries the same scopes, so a refresh can't fix it.)
const AUTH_FAILURE_CODES = new Set(['INVALID_TOKEN', 'AUTHENTICATION_FAILURE']);

/** Outbound CRM sync is turned on explicitly; off by default so it's inert until a tenant connects a CRM. */
function crmSyncEnabled() {
  return String(process.env.CRM_SYNC_ENABLED || '').trim().toLowerCase() === 'true';
}

// ── Zoho Lead_Status → our two-state LeadStatus. A rep engaging the lead in
// any way (contacted, qualified, converted) means CONTACTED here; an untouched
// lead is NEW. An unrecognised status returns null = leave the row unchanged,
// so a custom pipeline value can never silently reset a lead.
const CONTACTED_STATUSES = new Set([
  'contacted', 'attempted to contact', 'contact in future', 'pre-qualified',
  'qualified', 'converted', 'junk lead', 'lost lead', 'not qualified'
]);
const NEW_STATUSES = new Set(['not contacted', 'new']);

function mapZohoStatus(zohoStatus) {
  const s = String(zohoStatus || '').trim().toLowerCase();
  if (!s) return null;
  if (NEW_STATUSES.has(s)) return 'NEW';
  if (CONTACTED_STATUSES.has(s)) return 'CONTACTED';
  return null;
}

/** A link to the conversation in the dashboard, for the CRM note. Null when DASHBOARD_URL is unset. */
function conversationLink(sessionId) {
  const base = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const qs = sessionId ? `?${new URLSearchParams({ view: 'leads', session: sessionId })}` : '';
  return `${base}/dashboard/leads${qs}`;
}

// Zoho search criteria are not URL-parameters-as-usual: special characters in
// an email/phone would break the (Field:equals:value) grammar. Strip the few
// that matter rather than risk a malformed criteria string.
const criteriaValue = (v) => String(v || '').replace(/[()]/g, '').trim();

/**
 * Retry fn while it throws a CrmError marked retryable, backing off between
 * tries. Non-retryable errors (a 4xx, a bad token) throw immediately.
 * @param {Function} fn async, may receive the attempt number
 * @param {(attempt:number, err:Error)=>void} [onRetry]
 */
async function withRetry(fn, onRetry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      const delay = err?.retryable ? RETRY_DELAYS_MS[attempt] : undefined;
      if (delay === undefined) throw err;
      onRetry?.(attempt + 1, err);
      await sleep(delay);
    }
  }
}

/**
 * One authenticated Zoho CRM request. Returns { status, data }. Maps 429/5xx
 * and network/timeout failures to retryable CrmErrors; a 204 is a valid empty
 * result (e.g. a search that matched nothing).
 */
async function zohoRequest({ method, apiDomain, token, path, body, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${apiDomain}/crm/${API_VERSION()}${path}`, {
      method,
      headers: {
        authorization: `Zoho-oauthtoken ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    if (res.status === 204) return { status: 204, data: null };
    if (res.status === 429 || res.status >= 500) {
      throw new CrmError(`Zoho ${method} ${path} failed (${res.status})`, 502, { retryable: true });
    }
    let data = null;
    try { data = await res.json(); } catch { /* some endpoints return no body */ }
    if (res.status >= 400) {
      // Zoho's own error code (e.g. INVALID_TOKEN, DUPLICATE_DATA) — safe to
      // surface; never the raw body, which can echo request data.
      const code = data?.code || data?.data?.[0]?.code;
      // A rejected access token (revoked, or superseded by another refresh)
      // is flagged so the caller mints a new one instead of failing outright.
      const authFailure = res.status === 401 || AUTH_FAILURE_CODES.has(code);
      throw new CrmError(`Zoho ${method} ${path} rejected (${res.status}${code ? `, ${code}` : ''})`, 502, { authFailure });
    }
    return { status: res.status, data };
  } catch (err) {
    if (err instanceof CrmError) throw err;
    throw new CrmError(`Zoho ${method} ${path} request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find an existing lead by email and/or phone, so a repeat visitor doesn't
 * create a duplicate. Returns the first matching record id, or null.
 */
async function searchLead({ apiDomain, token, email, phone, fetchImpl }) {
  const parts = [];
  if (email) parts.push(`(Email:equals:${criteriaValue(email)})`);
  if (phone) parts.push(`(Phone:equals:${criteriaValue(phone)})`);
  if (!parts.length) return null;
  const criteria = parts.length > 1 ? `(${parts.join('or')})` : parts[0];
  const { status, data } = await zohoRequest({
    method: 'GET', apiDomain, token, fetchImpl,
    path: `/Leads/search?criteria=${encodeURIComponent(criteria)}`
  });
  if (status === 204 || !data?.data?.length) return null;
  return String(data.data[0].id);
}

const fieldMap = (fieldMapping = {}) => ({ email: 'Email', phone: 'Phone', name: 'Last_Name', source: 'Lead_Source', ...fieldMapping });

/** The Zoho fields that identify "the same person" for an upsert: the email, plus the phone when known. */
function duplicateCheckFields(fieldMapping = {}, extra = {}) {
  const map = fieldMap(fieldMapping);
  return extra.phone ? [map.email, map.phone] : [map.email];
}

/** Build the Zoho Lead field payload, honouring the tenant's editable fieldMapping. */
function leadFields({ lead, fieldMapping = {}, extra = {} }) {
  const map = fieldMap(fieldMapping);
  const fields = {};
  // Last_Name is required by Zoho; fall back to the email's local part.
  const name = extra.name || (lead.email ? lead.email.split('@')[0] : 'Website Visitor');
  fields[map.name] = name;
  if (lead.email) fields[map.email] = lead.email;
  if (extra.phone) fields[map.phone] = extra.phone;
  fields[map.source] = LEAD_SOURCE();
  return fields;
}

/** Create a lead; returns its new id. */
async function createLead({ apiDomain, token, fields, fetchImpl }) {
  const { data } = await zohoRequest({
    method: 'POST', apiDomain, token, fetchImpl, path: '/Leads',
    body: { data: [fields] }
  });
  const row = data?.data?.[0];
  if (!row || row.code !== 'SUCCESS' || !row.details?.id) {
    throw new CrmError(`Zoho lead create did not return an id (${row?.code || 'no row'})`, 502);
  }
  return String(row.details.id);
}

/** Update an existing lead with the latest activity. */
async function updateLead({ apiDomain, token, recordId, fields, fetchImpl }) {
  await zohoRequest({
    method: 'PUT', apiDomain, token, fetchImpl, path: `/Leads/${encodeURIComponent(recordId)}`,
    body: { data: [{ ...fields, id: recordId }] }
  });
  return String(recordId);
}

/** Attach a Note (AI summary + dashboard link) to a lead record. Best-effort. */
async function attachNote({ apiDomain, token, recordId, title, content, fetchImpl }) {
  await zohoRequest({
    method: 'POST', apiDomain, token, fetchImpl, path: '/Notes',
    body: { data: [{ Note_Title: title, Note_Content: content, Parent_Id: recordId, se_module: 'Leads' }] }
  });
}

/**
 * Create-or-update a lead in ONE atomic Zoho call. POST /Leads/upsert makes
 * Zoho itself match an existing record on `duplicate_check_fields` — the old
 * search-then-create raced: two captures of the same visitor both searched,
 * both found nothing, and both created a record.
 * @returns {Promise<{ crmRecordId: string, created: boolean }>}
 */
async function upsertLeadRecord({ apiDomain, token, fields, duplicateCheck, fetchImpl }) {
  const { data } = await zohoRequest({
    method: 'POST', apiDomain, token, fetchImpl, path: '/Leads/upsert',
    body: { data: [fields], duplicate_check_fields: duplicateCheck }
  });
  const row = data?.data?.[0];
  if (!row || row.code !== 'SUCCESS' || !row.details?.id) {
    throw new CrmError(`Zoho lead upsert did not return an id (${row?.code || 'no row'})`, 502);
  }
  return { crmRecordId: String(row.details.id), created: row.action === 'insert' };
}

/**
 * Upsert (atomic, deduplicated by email/phone) → note. Pure of persistence so
 * it's easy to unit test; syncLeadToCrm wraps it with retry, logging and DB mirroring.
 * @returns {Promise<{ crmRecordId: string, created: boolean }>}
 */
async function upsertLead({ apiDomain, token, lead, summary, sessionId, fieldMapping, extra = {}, fetchImpl }) {
  const fields = leadFields({ lead, fieldMapping, extra });
  const { crmRecordId, created } = await upsertLeadRecord({
    apiDomain, token, fields, duplicateCheck: duplicateCheckFields(fieldMapping, extra), fetchImpl
  });

  const link = conversationLink(sessionId || lead.sessionId);
  const body = [summary || 'A visitor engaged with the KGT Orb assistant and left their contact details.',
    link ? `\n\nConversation: ${link}` : ''].join('');
  // The note is value-add, not the point of the sync: don't fail an upsert if
  // only the note call errors.
  try {
    await attachNote({ apiDomain, token, recordId: crmRecordId, title: 'KGT Orb — AI chat summary', content: body, fetchImpl });
  } catch (err) {
    console.warn(`[crm] note attach failed for Zoho lead ${crmRecordId}: ${err.message}`);
  }

  return { crmRecordId, created };
}

const safeError = (err) => ({ message: String(err?.message || err), statusCode: err?.statusCode });

/**
 * Mirror a captured lead into the tenant's Zoho CRM. Never throws: it is
 * started fire-and-forget from the chat path, so every failure is caught,
 * audited in CRMSyncLog and logged. No-op unless CRM_SYNC_ENABLED and the
 * tenant has an enabled Zoho integration.
 * @param {object} params
 * @param {object} params.tenant { id, slug }
 * @param {object} params.lead a Lead row ({ id, email, sessionId, ... })
 * @param {string} [params.summary] the AI chat summary for the note
 * @param {object} [deps] { prisma, fetchImpl, getToken, now } — for tests
 * @returns {Promise<object>} a result describing what happened (never rejects)
 */
async function syncLeadToCrm({ tenant, lead, summary = null, extra = {} }, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const fetchImpl = deps.fetchImpl || fetch;
  const getToken = deps.getToken || getAccessToken;
  const now = deps.now || Date.now();

  if (!crmSyncEnabled()) return { skipped: 'disabled' };
  if (!isZohoConfigured()) return { skipped: 'unconfigured' };

  let integration;
  try {
    integration = await prisma.tenantCRMIntegration.findUnique({ where: { tenantId: tenant.id } });
  } catch (err) {
    console.error(`[crm] could not load integration for tenant ${tenant.slug || tenant.id}: ${err.message}`);
    return { skipped: 'lookup-failed' };
  }
  if (!integration || !integration.isEnabled) return { skipped: 'no-integration' };
  if (integration.provider !== 'ZOHO') return { skipped: `provider-${integration.provider}` };

  const logId = await createSyncLog(prisma, {
    tenantId: tenant.id, integrationId: integration.id, leadId: lead.id, operation: 'lead.upsert'
  });

  try {
    let { accessToken, apiDomain } = await getToken({ integration, prisma, fetchImpl, now });
    let attempts = 0;
    const attempt = () => withRetry(
      () => upsertLead({
        apiDomain, token: accessToken, lead, summary, sessionId: lead.sessionId,
        fieldMapping: integration.fieldMapping || {}, extra, fetchImpl
      }),
      (n, err) => { attempts += 1; console.warn(`[crm] lead ${lead.id} sync retry ${n}: ${err.message}`); }
    );
    let outcome;
    try {
      outcome = await attempt();
    } catch (err) {
      if (!err?.authFailure) throw err;
      // The stored token still looked fresh but Zoho rejected it (revoked, or
      // superseded by another refresh). Mint a new one and retry — once: a
      // second rejection means the connection itself is broken.
      console.warn(`[crm] lead ${lead.id}: Zoho rejected the access token — refreshing it and retrying once`);
      ({ accessToken, apiDomain } = await getToken({ integration, prisma, fetchImpl, now, force: true }));
      attempts += 1;
      outcome = await attempt();
    }
    const { crmRecordId, created } = outcome;

    // Mirror the CRM id back so an inbound status webhook can find this lead.
    await prisma.lead.update({
      where: { id: lead.id },
      data: { crmProvider: 'ZOHO', crmRecordId, crmSyncedAt: new Date(now) }
    }).catch((err) => console.warn(`[crm] could not mirror CRM id onto lead ${lead.id}: ${err.message}`));

    await updateSyncLog(prisma, logId, { status: 'SUCCESS', crmRecordId, attempts });
    console.log(`[crm] lead ${lead.id} ${created ? 'created in' : 'updated in'} Zoho as ${crmRecordId} (tenant ${tenant.slug || tenant.id})`);
    return { synced: true, crmRecordId, created };
  } catch (err) {
    await updateSyncLog(prisma, logId, { status: 'FAILED', error: safeError(err) });
    console.error(`[crm] ERROR: lead ${lead.id} sync FAILED (tenant ${tenant.slug || tenant.id}): ${err.message}`);
    return { synced: false, error: err.message };
  }
}

/**
 * Apply an inbound Zoho status change to the matching Lead. Lead identity is the
 * (crmProvider, crmRecordId) compound key — a CRM record id is unique within its
 * provider, so this resolves to exactly one mirrored lead; the tenant hint
 * narrows it further when present. The email fallback is TENANT-SCOPED ONLY:
 * with no tenant it is refused rather than risk mutating another tenant's lead
 * that happens to share an email. An unmapped record id is reported, never
 * applied to an arbitrary row. Never throws.
 * @returns {Promise<{ updated: boolean, reason?: string, leadId?: string, status?: string, tenantId?: string }>}
 */
async function applyInboundStatus({ recordId, zohoStatus, tenantId = null, email = null, provider = 'ZOHO' }, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const now = deps.now ? new Date(deps.now) : new Date();

  const status = mapZohoStatus(zohoStatus);
  if (!status) return { updated: false, reason: 'unmapped-status' };

  try {
    const tenantScope = tenantId ? { tenantId } : {};
    // Primary, always-safe match: the (crmProvider, crmRecordId) compound key.
    // A CRM record id is unique within its provider, so this identifies exactly
    // one mirrored lead; we still narrow to the tenant hint when we have one.
    let lead = recordId
      ? await prisma.lead.findFirst({ where: { ...tenantScope, crmProvider: provider, crmRecordId: String(recordId) } })
      : null;

    // Email fallback — TENANT-SCOPED ONLY. Without a tenant, an email can match a
    // different tenant's lead, so refuse rather than mutate an arbitrary row.
    if (!lead && email) {
      if (!tenantId) return { updated: false, reason: 'email-match-needs-tenant' };
      lead = await prisma.lead.findFirst({
        where: { tenantId, email: String(email).toLowerCase() },
        orderBy: { createdAt: 'desc' }
      });
    }

    // An external record id we don't recognise is logged by the caller, not
    // applied to some other row.
    if (!lead) return { updated: false, reason: recordId ? 'unmapped-record' : 'lead-not-found' };

    // Captured before the update, which may mutate the loaded row in place.
    const changed = lead.status !== status;
    if (changed) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status } });
    }
    await createSyncLog(prisma, {
      tenantId: lead.tenantId, leadId: lead.id, operation: 'webhook.status',
      direction: 'inbound', status: 'SUCCESS', crmRecordId: recordId ? String(recordId) : null, at: now
    });
    return { updated: changed, leadId: lead.id, status, tenantId: lead.tenantId };
  } catch (err) {
    console.error(`[crm] ERROR: inbound status update FAILED (record ${recordId}): ${err.message}`);
    return { updated: false, reason: 'exception' };
  }
}

// ── CRMSyncLog helpers. Best-effort: the audit row must never be what breaks a
// sync, so a logging failure is swallowed (and returns null).
async function createSyncLog(prisma, { tenantId, integrationId = null, leadId = null, operation, direction = 'outbound', status = 'PENDING', crmRecordId = null }) {
  try {
    const row = await prisma.cRMSyncLog.create({
      data: { tenantId, integrationId, leadId, operation, direction, status, crmRecordId }
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
  upsertLeadRecord,
  duplicateCheckFields,
  // searchLead / createLead / updateLead: no longer used by the sync (one
  // atomic upsert replaced them); kept for callers that need a lookup or a
  // one-sided write.
  searchLead,
  createLead,
  updateLead,
  attachNote,
  leadFields,
  mapZohoStatus,
  conversationLink,
  withRetry,
  zohoRequest,
  crmSyncEnabled,
  RETRY_DELAYS_MS
};
