const defaultPrisma = require('../../lib/prisma');
const { logger } = require('../../lib/logger');
const { withRetry } = require('../crm/zohoSync');
const {
  createFreshdeskTicket, createZohoDeskTicket, isZohoDeskConfigured
} = require('./helpdeskClient');

// Mirror an escalated KGT ticket into the tenant's connected helpdesk (Feature
// 5). Started fire-and-forget from engine/ticketing.js and domains/handoffActions
// (once a contact email arrives), so it NEVER throws and NEVER blocks a chat
// turn: a down, misconfigured or unconfigured helpdesk simply leaves the KGT
// ticket as-is and records why in HelpdeskSyncLog. Everything safe-fails.

/** A global kill switch; on by default (a tenant connecting a helpdesk IS the opt-in). */
function helpdeskSyncEnabled() {
  return String(process.env.HELPDESK_SYNC_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

const KIND_LABEL = {
  human_request: 'Visitor asked to talk to a person',
  demo_request: 'Visitor asked for a demo',
  contact_request: 'Visitor left their email',
  unanswered: 'Assistant could not answer',
  outage: 'Assistant was unavailable'
};

const truncate = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Render the stored transcript (JSON array of { role, content }) as plain lines. */
function renderTranscript(transcript) {
  if (!Array.isArray(transcript) || !transcript.length) return '';
  return transcript
    .filter((t) => t && t.content)
    .map((t) => `${t.role === 'assistant' ? 'Assistant' : 'Visitor'}: ${String(t.content).trim()}`)
    .join('\n');
}

/** The provider-neutral ticket payload built from a KGT SupportTicket row. */
function buildPayload(ticket, { botType } = {}) {
  const label = KIND_LABEL[ticket.kind] || 'Escalation from the website assistant';
  const subjectDetail = truncate(ticket.query, 80);
  const parts = [
    `A visitor conversation with the KGT Orb ${botType || ticket.botType || 'support'} assistant was escalated.`,
    '',
    `Reason: ${label}`,
    ticket.query ? `\nVisitor's message:\n${String(ticket.query).trim()}` : '',
    ticket.replyEta ? `\nReply ETA promised to the visitor: ${ticket.replyEta}` : '',
    ticket.contactEmail ? `\nContact email: ${ticket.contactEmail}` : ''
  ];
  const transcript = renderTranscript(ticket.transcript);
  if (transcript) parts.push(`\nConversation so far:\n${transcript}`);
  return {
    subject: subjectDetail ? `${label} — ${subjectDetail}` : label,
    description: parts.filter((p) => p !== '').join('\n'),
    email: ticket.contactEmail || null,
    tags: ['kgt-orb', botType || ticket.botType || 'support', ticket.kind].filter(Boolean)
  };
}

const safeError = (err) => ({ message: String(err?.message || err), statusCode: err?.statusCode });

async function createLog(prisma, data) {
  try { return (await prisma.helpdeskSyncLog.create({ data })).id; } catch { return null; }
}
async function updateLog(prisma, id, data) {
  if (!id) return;
  try { await prisma.helpdeskSyncLog.update({ where: { id }, data }); } catch { /* audit is best-effort */ }
}

/**
 * Push a KGT ticket to the tenant's helpdesk. Resolves to a result describing
 * what happened; never rejects.
 * @param {{ tenant?: object, tenantId?: string, ticket: object, botType?: string }} params
 *   ticket is a SupportTicket row (id, query, kind, contactEmail, transcript, …)
 * @param {{ prisma?, fetchImpl?, now? }} [deps]
 */
async function createHelpdeskTicket({ tenant, tenantId, ticket, botType = null }, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now();
  const tid = tenantId || tenant?.id;

  if (!helpdeskSyncEnabled()) return { skipped: 'disabled' };
  if (!tid || !ticket?.id) return { skipped: 'no-ticket' };
  // Already mirrored (e.g. an email arrived after the ticket was pushed): no dup.
  if (ticket.helpdeskTicketId) return { skipped: 'already-synced' };

  let integration;
  try {
    integration = await prisma.tenantHelpdeskIntegration.findUnique({ where: { tenantId: tid } });
  } catch (err) {
    logger.error(`[helpdesk] could not load integration for tenant ${tid}: ${err.message}`);
    return { skipped: 'lookup-failed' };
  }
  if (!integration || !integration.isEnabled) return { skipped: 'no-integration' };

  const payload = buildPayload(ticket, { botType });

  // Freshdesk requires a requester email. Without one yet, record a SKIP (not a
  // failure) — the push retries once the visitor leaves their email.
  if (integration.provider === 'freshdesk' && !payload.email) {
    await createLog(prisma, {
      tenantId: tid, integrationId: integration.id, ticketId: ticket.id,
      provider: integration.provider, status: 'SKIPPED', error: safeError(new Error('awaiting a contact email'))
    });
    return { skipped: 'no-contact-email' };
  }
  if (integration.provider === 'zoho_desk' && !isZohoDeskConfigured()) return { skipped: 'unconfigured' };

  const logId = await createLog(prisma, {
    tenantId: tid, integrationId: integration.id, ticketId: ticket.id, provider: integration.provider, status: 'PENDING'
  });

  let attempts = 0;
  try {
    const run = () => (integration.provider === 'freshdesk'
      ? createFreshdeskTicket({ domain: integration.freshdeskDomain, apiKey: decryptKey(integration.apiKey), ticket: payload, fetchImpl })
      : createZohoDeskTicket({ integration, ticket: payload, fetchImpl, now }));
    const { externalId } = await withRetry(run, (n, err) => {
      attempts += 1;
      logger.warn(`[helpdesk] ticket ${ticket.id} create retry ${n}: ${err.message}`);
    });

    await updateLog(prisma, logId, { status: 'SUCCESS', externalTicketId: externalId, attempts });
    // Mirror the external id back onto the KGT ticket (best-effort).
    await prisma.supportTicket.update({
      where: { id: ticket.id }, data: { helpdeskProvider: integration.provider, helpdeskTicketId: externalId }
    }).catch((err) => logger.warn(`[helpdesk] could not mirror id onto ticket ${ticket.id}: ${err.message}`));

    logger.info(`[helpdesk] ticket ${ticket.id} → ${integration.provider} ${externalId} (tenant ${tid})`);
    return { synced: true, provider: integration.provider, externalTicketId: externalId };
  } catch (err) {
    await updateLog(prisma, logId, { status: 'FAILED', attempts, error: safeError(err) });
    logger.error(`[helpdesk] ERROR: ticket ${ticket.id} push FAILED (tenant ${tid}): ${err.message}`);
    return { synced: false, error: err.message };
  }
}

// Freshdesk API key is stored encrypted; decrypt lazily (require here to avoid a
// cycle at load and to keep this module's surface small).
function decryptKey(value) {
  if (!value) return null;
  try { return require('../../utils/encryption').decrypt(value); } catch { return null; }
}

module.exports = { createHelpdeskTicket, helpdeskSyncEnabled, buildPayload, renderTranscript };
