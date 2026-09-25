const prisma = require('../lib/prisma');

// Pillar 4's HITL half: when the confidence gate fails, persist a ticket
// instead of just returning a message into the void. Opt-in per profile
// (profile.ticketing truthy) — only tenant profiles set this today.

/**
 * @param {{ profile: object, query: string, confidence: number, ctx: object }} params
 */
async function fileSupportTicket({ profile, query, confidence, ctx }) {
  if (!ctx.tenantId) return null; // ticketing requires a tenant to scope the ticket to
  try {
    return await prisma.supportTicket.create({
      data: {
        tenantId: ctx.tenantId,
        query,
        confidence,
        transcript: ctx.recentTurns || [],
        status: 'open'
      }
    });
  } catch (err) {
    console.error('[ticketing] fileSupportTicket failed:', err.message);
    return null; // never let a logging failure break the chat response
  }
}

module.exports = { fileSupportTicket };
