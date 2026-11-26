const prisma = require('../lib/prisma');
const { logger } = require('../lib/logger');

// Pillar 4's HITL half: every handoff to a person becomes a ticket instead of
// a message into the void. Opt-in per profile (profile.ticketing truthy) —
// only tenant profiles set this today.
//
// kind: unanswered      below the confidence threshold (confidence is set)
//       outage          every LLM provider failed
//       human_request   the visitor asked for a person
//       demo_request    the visitor asked for a demo or walkthrough
//       contact_request the visitor left an email after a reply that couldn't help
// A visitor's email, left later in the same conversation, is attached by
// attachContact() below (domains/handoffActions.js).

/**
 * @param {{ profile: object, query: string, confidence?: number|null, ctx: object,
 *           kind?: string, contactEmail?: string|null, replyEta?: string|null }} params
 *   replyEta: the reply-time message shown to the visitor at escalation (Feature
 *   5, services/escalation.js), stored as a snapshot on the ticket.
 */
async function fileSupportTicket({ profile, query, confidence = null, ctx, kind = 'unanswered', contactEmail = null, replyEta = null }) {
  if (!ctx.tenantId) return null; // ticketing requires a tenant to scope the ticket to
  if (ctx.sandbox) return null;   // a dashboard test chat never files a real ticket
  try {
    const ticket = await prisma.supportTicket.create({
      data: {
        tenantId: ctx.tenantId,
        query,
        confidence: confidence ?? null,
        kind,
        botType: profile.botType ?? null,
        sessionId: ctx.sessionId ?? null,
        contactEmail,
        replyEta: replyEta || null,
        transcript: ctx.recentTurns || [],
        status: 'open'
      }
    });
    // Mirror the escalation into the tenant's helpdesk, if one is connected
    // (Feature 5). Fire-and-forget and defensive: a down or unconfigured
    // helpdesk never affects the chat reply or this ticket.
    pushToHelpdesk({ tenantId: ctx.tenantId, ticket, botType: profile.botType });
    // Announce the new ticket to the tenant's outbound integrations (webhooks /
    // Google Sheets, Feature 8). Same fire-and-forget discipline as the helpdesk mirror.
    emitTicketEvent(ctx.tenantId, ticket);
    return ticket;
  } catch (err) {
    logger.error('[ticketing] fileSupportTicket failed:', err.message);
    return null; // never let a logging failure break the chat response
  }
}

// Fire-and-forget integration event (webhooks / Google Sheets, Feature 8).
// Lazily required to avoid a load-time cycle and so the engine stays lean; any
// error (including a module-load error) is swallowed — this is best-effort.
function emitTicketEvent(tenantId, ticket) {
  try {
    const { emitTenantEvent } = require('../services/integrationEvents');
    Promise.resolve(emitTenantEvent(tenantId, 'ticket.created', {
      ticketId: ticket.id, kind: ticket.kind, botType: ticket.botType,
      sessionId: ticket.sessionId, query: ticket.query, contactEmail: ticket.contactEmail || null
    })).catch((err) => logger.warn('[ticketing] integration event failed:', err.message));
  } catch (err) {
    logger.warn('[ticketing] integration events unavailable:', err.message);
  }
}

// Fire-and-forget helpdesk mirror. Required lazily to avoid a load-time cycle
// (helpdeskSync → crm/zohoSync → …) and so the engine stays lean. Any error
// (including a module-load error) is swallowed — this is best-effort.
function pushToHelpdesk(args) {
  try {
    const { createHelpdeskTicket } = require('../services/helpdesk/helpdeskSync');
    Promise.resolve(createHelpdeskTicket(args)).catch((err) =>
      logger.warn('[ticketing] helpdesk push failed:', err.message));
  } catch (err) {
    logger.warn('[ticketing] helpdesk push unavailable:', err.message);
  }
}

/**
 * Puts an email on this conversation's most recent open ticket that has none.
 * @returns {Promise<object|null>} the updated ticket, or null if there wasn't one
 */
async function attachContact({ ctx, contactEmail }) {
  if (!ctx.tenantId || !ctx.sessionId) return null;
  const ticket = await prisma.supportTicket.findFirst({
    where: { tenantId: ctx.tenantId, sessionId: ctx.sessionId, status: 'open', contactEmail: null },
    orderBy: { createdAt: 'desc' }
  });
  if (!ticket) return null;
  const updated = await prisma.supportTicket.update({ where: { id: ticket.id }, data: { contactEmail } });
  // Now that we have a contact email, mirror this escalation to the helpdesk if
  // it wasn't pushed already (e.g. Freshdesk, which needs a requester email).
  if (!updated.helpdeskTicketId) pushToHelpdesk({ tenantId: ctx.tenantId, ticket: updated, botType: updated.botType });
  return updated;
}

module.exports = { fileSupportTicket, attachContact };
