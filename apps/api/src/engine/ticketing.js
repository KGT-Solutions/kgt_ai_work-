const prisma = require('../lib/prisma');

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
 *           kind?: string, contactEmail?: string|null }} params
 */
async function fileSupportTicket({ profile, query, confidence = null, ctx, kind = 'unanswered', contactEmail = null }) {
  if (!ctx.tenantId) return null; // ticketing requires a tenant to scope the ticket to
  try {
    return await prisma.supportTicket.create({
      data: {
        tenantId: ctx.tenantId,
        query,
        confidence: confidence ?? null,
        kind,
        botType: profile.botType ?? null,
        sessionId: ctx.sessionId ?? null,
        contactEmail,
        transcript: ctx.recentTurns || [],
        status: 'open'
      }
    });
  } catch (err) {
    console.error('[ticketing] fileSupportTicket failed:', err.message);
    return null; // never let a logging failure break the chat response
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
  return prisma.supportTicket.update({ where: { id: ticket.id }, data: { contactEmail } });
}

module.exports = { fileSupportTicket, attachContact };
