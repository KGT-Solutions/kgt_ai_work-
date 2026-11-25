const crypto = require('crypto');
const { logger } = require('../lib/logger');

// Integration event bus (Feature 8). One place the rest of the app calls when
// something worth telling the outside world happens — a lead was captured, a
// ticket was filed, a conversation wrapped up. Each event fans out to the
// tenant's outbound integrations:
//   • generic webhooks   (services/webhooks.js)
//   • Google Sheets sync (services/sheetsSync.js)
//
// Everything here is fire-and-forget and defensive, exactly like the CRM /
// helpdesk mirrors (services/crm/zohoSync.js, engine/ticketing.js): a slow or
// broken integration must NEVER delay or break a chat reply, a lead capture or
// a ticket. The emit points call emitTenantEvent() without awaiting it, and it
// swallows every error. The delivery modules are required lazily so this file
// (pulled in from leads.js / ticketing.js / chatSessions.js) never forms a
// load-time cycle with them.

// The event names a tenant can subscribe a webhook / sheet to. Kept small,
// stable and documented — adding one here is what makes it selectable in the UI
// and accepted by the webhook/sheet validators.
const EVENTS = Object.freeze([
  'lead.created',            // a visitor left their email (services/leads.js captureLead)
  'ticket.created',          // a chat escalated to a human-handled ticket (engine/ticketing.js)
  'chat.session.completed'   // a conversation was summarized / wrapped up (services/chatSessions.js, services/leads.js)
]);

function isEvent(name) {
  return EVENTS.includes(String(name || '').trim());
}

/**
 * Build the signed envelope every integration receives. `data` is the
 * per-event, already-safe payload (no secrets, no raw provider bodies).
 */
function buildEvent(event, tenantId, data, { now = Date.now(), id = crypto.randomUUID() } = {}) {
  return { id, event, tenantId, createdAt: new Date(now).toISOString(), data: data || {} };
}

/**
 * Announce one tenant event to every outbound integration. Never throws and
 * never rejects in a way the caller must handle: the returned promise always
 * resolves (to a small result for tests), so callers can `void emitTenantEvent(...)`.
 * @param {string} tenantId
 * @param {string} event one of EVENTS
 * @param {object} data the event payload (safe fields only)
 * @param {object} [deps] { prisma, webhooks, sheetsSync, fetchImpl, now } — for tests
 */
async function emitTenantEvent(tenantId, event, data, deps = {}) {
  if (!tenantId || !isEvent(event)) {
    if (event && !isEvent(event)) logger.warn(`[events] ignoring unknown event "${event}"`);
    return { delivered: false, reason: 'skipped' };
  }
  const envelope = buildEvent(event, tenantId, data, deps);
  // Lazy to avoid a require cycle (leads → integrationEvents → webhooks → prisma …).
  const webhooks = deps.webhooks || safeRequire('./webhooks');
  const sheetsSync = deps.sheetsSync || safeRequire('./sheetsSync');

  const results = await Promise.allSettled([
    webhooks ? webhooks.emitEvent(tenantId, envelope, deps) : Promise.resolve(null),
    sheetsSync ? sheetsSync.syncEvent(tenantId, envelope, deps) : Promise.resolve(null)
  ]);
  for (const r of results) {
    if (r.status === 'rejected') logger.warn(`[events] ${event} delivery dispatch error (tenant ${tenantId}): ${r.reason?.message || r.reason}`);
  }
  return { delivered: true, event, id: envelope.id };
}

function safeRequire(path) {
  try {
    return require(path);
  } catch (err) {
    logger.warn(`[events] integration module ${path} unavailable: ${err.message}`);
    return null;
  }
}

module.exports = { EVENTS, isEvent, buildEvent, emitTenantEvent };
