const defaultPrisma = require('../lib/prisma');
const { logger } = require('../lib/logger');

// Chat-log retention (Feature 16). Conversations are kept for a FIXED window on
// the KGT server and then removed — there is no per-tenant, user-configurable
// period any more. The window is 30 days by default; an operator may override it
// with CHAT_RETENTION_DAYS (server-side only), but a tenant can never set it,
// leave it blank ("keep for ever"), or opt out. A tenant that needs its data on
// its own server is handled off-platform (the dashboard tells them to contact
// the team).
//
// TenantRetentionSettings is kept only for bookkeeping (lastPurgeAt /
// lastPurgedCount); its retentionDays / autoPurgeEnabled columns are no longer
// read, so no migration is needed to drop them.
//
// Lead transcripts: a captured lead keeps its own copy of the conversation
// (Lead.fullTranscript + Lead.chatSummary) so a rep can follow up, and a Lead is
// a business record the sweep must NEVER delete. But the raw transcript is still
// conversation content, so the sweep REDACTS it at the same cutoff — the lead's
// contact, status and CRM link stay; the verbatim messages are emptied. This is
// what makes the promise honest: no raw conversation content, chat log OR lead
// transcript, survives the window.
//
// Safety is still the whole point — a purge deletes real conversation history:
//   • Fixed floor (MIN_RETENTION_DAYS): a bad CHAT_RETENTION_DAYS can't wipe
//     everything; it clamps into [MIN, MAX].
//   • Dry-run: purgeTenant({ dryRun:true }) only counts, deletes nothing.
//   • Tenant-scoped: the cutoff filter always carries tenantId.

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650; // ~10 years
const DEFAULT_RETENTION_DAYS = 30; // the fixed KGT-server policy
const DAY_MS = 24 * 60 * 60 * 1000;

class RetentionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RetentionError';
    this.statusCode = statusCode;
  }
}

/**
 * The fixed retention window, in days. 30 unless an operator overrides it with a
 * valid CHAT_RETENTION_DAYS; the override is clamped into [MIN, MAX] so a typo
 * can never disable retention or keep data for ever.
 */
function serverRetentionDays() {
  const n = Number(process.env.CHAT_RETENTION_DAYS);
  if (!Number.isInteger(n) || n < MIN_RETENTION_DAYS) return DEFAULT_RETENTION_DAYS;
  return Math.min(n, MAX_RETENTION_DAYS);
}

function toView(row) {
  return {
    retentionDays: serverRetentionDays(), // fixed, server-controlled
    fixed: true, // the UI renders this read-only
    editable: false, // no tenant-configurable period
    selfHostContact: true, // show "contact the team to self-host your data"
    lastPurgeAt: row?.lastPurgeAt || null,
    lastPurgedCount: row?.lastPurgedCount ?? null,
    minDays: MIN_RETENTION_DAYS,
    maxDays: MAX_RETENTION_DAYS
  };
}

async function getRetentionSettings(tenantId, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantRetentionSettings.findUnique({ where: { tenantId } }).catch(() => null);
  return toView(row);
}

/** The cutoff instant: sessions last active before this are eligible for purge. */
function cutoffFor(retentionDays, now = Date.now()) {
  return new Date(now - retentionDays * DAY_MS);
}

// A session is eligible when its last activity is before the cutoff. lastMessageAt
// is the primary clock; brand-new sessions that never got a message fall back to
// createdAt so an abandoned-at-open session is still covered.
function eligibleWhere(tenantId, cutoff) {
  return {
    tenantId,
    OR: [
      { lastMessageAt: { lt: cutoff } },
      { AND: [{ lastMessageAt: null }, { createdAt: { lt: cutoff } }] }
    ]
  };
}

/** Whether the sweep also clears Lead.chatSummary (off by default — the summary
 * is a short derived note a rep keeps with the contact, not raw content). An
 * operator who wants the strictest reading sets CHAT_RETENTION_REDACT_LEAD_SUMMARY=true. */
function redactLeadSummary() {
  return String(process.env.CHAT_RETENTION_REDACT_LEAD_SUMMARY || '').trim().toLowerCase() === 'true';
}

// Leads whose conversation is past the cutoff and still carry a transcript.
// Keyed on createdAt (≈ when the email was captured during the chat), so a
// lead's transcript ages out together with the chat log it was copied from. The
// non-empty filter makes the sweep idempotent: once redacted, a lead is no
// longer matched, so the daily sweep never re-writes rows it already cleared.
function leadsToRedactWhere(tenantId, cutoff) {
  return { tenantId, createdAt: { lt: cutoff }, NOT: { fullTranscript: { equals: [] } } };
}

/**
 * Count (dryRun) or redact a tenant's lead transcripts past the cutoff. Never
 * throws: a Json-filter incompatibility or a missing model degrades to zero and
 * is logged, so it can never block the conversation purge that ran first.
 * @returns {Promise<{ leadsEligible: number, leadsRedacted: number }>}
 */
async function redactTenantLeads(tenantId, cutoff, { dryRun = false, prisma = defaultPrisma } = {}) {
  const where = leadsToRedactWhere(tenantId, cutoff);
  try {
    if (dryRun) return { leadsEligible: await prisma.lead.count({ where }), leadsRedacted: 0 };
    const data = { fullTranscript: [] };
    if (redactLeadSummary()) { data.chatSummary = null; data.summaryStatus = 'redacted'; }
    const { count } = await prisma.lead.updateMany({ where, data });
    return { leadsEligible: count, leadsRedacted: count };
  } catch (err) {
    logger.warn(`[retention] lead transcript redaction skipped for tenant ${tenantId}: ${err.message}`);
    return { leadsEligible: 0, leadsRedacted: 0 };
  }
}

/**
 * Purge (or, with dryRun, just count) a tenant's conversations older than the
 * fixed server retention window, and redact the transcript copy on any lead past
 * the same window (the lead's contact / status / CRM link are kept).
 * @param {string} tenantId
 * @param {{ dryRun?: boolean, now?: number, prisma?: object }} [opts]
 * @returns {Promise<{ purged: boolean, eligible: number, deleted: number, leadsEligible: number, leadsRedacted: number, cutoff: string, retentionDays: number }>}
 */
async function purgeTenant(tenantId, { dryRun = false, now = Date.now(), prisma = defaultPrisma } = {}) {
  const retentionDays = serverRetentionDays();
  const cutoff = cutoffFor(retentionDays, now);
  const where = eligibleWhere(tenantId, cutoff);
  const eligible = await prisma.chatSession.count({ where });

  if (dryRun) {
    const { leadsEligible } = await redactTenantLeads(tenantId, cutoff, { dryRun: true, prisma });
    return { purged: false, eligible, deleted: 0, leadsEligible, leadsRedacted: 0, cutoff: cutoff.toISOString(), retentionDays };
  }

  // Deleting the sessions cascades their ChatMessages (schema onDelete: Cascade).
  const { count } = await prisma.chatSession.deleteMany({ where });
  // Redact lead transcripts past the same cutoff (best-effort; see redactTenantLeads).
  const { leadsRedacted } = await redactTenantLeads(tenantId, cutoff, { dryRun: false, prisma });
  // Bookkeeping only; upsert so it works even for a tenant that never had a row.
  await prisma.tenantRetentionSettings.upsert({
    where: { tenantId },
    update: { lastPurgeAt: new Date(now), lastPurgedCount: count },
    create: { tenantId, lastPurgeAt: new Date(now), lastPurgedCount: count }
  }).catch(() => { /* bookkeeping is best-effort */ });

  return { purged: true, eligible, deleted: count, leadsEligible: leadsRedacted, leadsRedacted, cutoff: cutoff.toISOString(), retentionDays };
}

/**
 * Purge EVERY tenant's conversations older than the fixed window. Retention is a
 * server policy now, so the sweep covers all tenants rather than only ones that
 * opted in. Never throws: a failure for one tenant is logged and the sweep
 * continues.
 * @returns {Promise<{ tenants: number, deleted: number, leadsRedacted: number }>}
 */
async function runRetentionSweep({ now = Date.now(), prisma = defaultPrisma } = {}) {
  let rows = [];
  try {
    rows = await prisma.tenant.findMany({ select: { id: true } });
  } catch (err) {
    logger.error(`[retention] sweep could not list tenants: ${err.message}`);
    return { tenants: 0, deleted: 0, leadsRedacted: 0 };
  }
  let deleted = 0;
  let leadsRedacted = 0;
  for (const { id: tenantId } of rows) {
    try {
      const res = await purgeTenant(tenantId, { now, prisma });
      deleted += res.deleted || 0;
      leadsRedacted += res.leadsRedacted || 0;
      if (res.deleted || res.leadsRedacted) {
        logger.info(`[retention] tenant ${tenantId}: purged ${res.deleted} conversation(s), redacted ${res.leadsRedacted} lead transcript(s)`);
      }
    } catch (err) {
      logger.error(`[retention] purge failed for tenant ${tenantId}: ${err.message}`);
    }
  }
  return { tenants: rows.length, deleted, leadsRedacted };
}

let sweepTimer = null;

/**
 * Start the periodic retention sweep. Retention is now a fixed product policy, so
 * the sweep runs by default; set RETENTION_SWEEP_ENABLED=false to pause it (e.g.
 * while migrating data). Interval is RETENTION_SWEEP_INTERVAL_MIN (default 24h).
 */
function startRetentionWorker() {
  if (sweepTimer) return sweepTimer;
  if (String(process.env.RETENTION_SWEEP_ENABLED || '').trim().toLowerCase() === 'false') return null;
  const intervalMs = Math.max(1, Number(process.env.RETENTION_SWEEP_INTERVAL_MIN || 24 * 60)) * 60 * 1000;
  sweepTimer = setInterval(() => {
    runRetentionSweep().catch((err) => logger.error(`[retention] sweep error: ${err.message}`));
  }, intervalMs);
  sweepTimer.unref?.();
  logger.info(`[retention] auto-purge sweep enabled (${serverRetentionDays()}-day window, every ${Math.round(intervalMs / 60000)} min)`);
  return sweepTimer;
}

function stopRetentionWorker() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

module.exports = {
  RetentionError,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  serverRetentionDays,
  getRetentionSettings,
  cutoffFor,
  eligibleWhere,
  leadsToRedactWhere,
  redactTenantLeads,
  purgeTenant,
  runRetentionSweep,
  startRetentionWorker,
  stopRetentionWorker,
  toView
};
