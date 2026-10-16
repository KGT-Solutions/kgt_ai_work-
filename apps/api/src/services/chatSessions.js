const prisma = require('../lib/prisma');
const { generateAnswer, isLlmConfigured, formatAttempts } = require('../engine/llmClient');
const { logUsage } = require('../engine/usageTracking');
const { buildSummaryPrompt, cleanSummary, scheduleLeadSummary, loadTranscript } = require('./leads');

// Session-wise conversation summaries: every conversation with a bot gets an
// AI summary (intent, questions asked, outcome) for the dashboard's Sessions
// view, not only the ones where the visitor left an email.
//
// When: the widget has no reliable "chat over" signal, so a conversation is
// summarized once it has been idle SESSION_SUMMARY_IDLE_SEC (2 min), or right
// away when the widget reports the page closed (POST /session/end). A worker
// (startSessionSummaryWorker, run by server.js) sweeps the database every
// SESSION_SUMMARY_SWEEP_SEC for idle conversations whose summary is missing
// or older than their last message, so nothing depends on in-memory timers
// and a restart loses nothing.
//
// A conversation that produced a lead is summarized by services/leads.js
// (which copies its summary here); this module only hands it over, so each
// conversation costs one LLM call, not two.

const SUMMARY_IDLE_MS = Number(process.env.SESSION_SUMMARY_IDLE_SEC || 120) * 1000;
const SWEEP_MS = Number(process.env.SESSION_SUMMARY_SWEEP_SEC || 60) * 1000;
// Only conversations active this recently are picked up: the migration's
// backfill (and a long outage) must not turn into a burst of LLM calls.
const LOOKBACK_HOURS = Number(process.env.SESSION_SUMMARY_LOOKBACK_HOURS || 24);
const SWEEP_BATCH = Number(process.env.SESSION_SUMMARY_BATCH || 10);
// A single greeting and its reply aren't worth a summary.
const MIN_MESSAGES = 2;

// sessionId -> { rerun } while a summary is being written, as in leads.js:
// a request mid-run queues exactly one more run.
const running = new Map();

/**
 * Updates the conversation's bookkeeping after a turn's two messages are
 * stored. Never throws: it must not break the chat reply.
 * @param {{ session: { id, botType? }, botType: string }} params
 */
async function recordTurn({ session, botType }) {
  try {
    await prisma.chatSession.update({
      where: { id: session.id },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 2 },
        endedAt: null, // a turn after "page closed" means the conversation went on
        ...(session.botType ? {} : { botType })
      }
    });
  } catch (err) {
    console.warn(`[sessions] session ${session.id}: could not update its bookkeeping: ${err.message}`);
  }
}

/**
 * Writes one conversation's summary. Never throws: a failure is recorded on
 * the row (summaryStatus "failed") and logged. Conversations with leads are
 * handed to services/leads.js instead.
 * @returns {Promise<object|null>} the updated session, or null
 */
async function summarizeSession(sessionId) {
  const finish = (data) => prisma.chatSession.update({ where: { id: sessionId }, data: { ...data, summarizedAt: new Date() } })
    .catch(() => null); // session deleted mid-run
  const fail = (message) => {
    console.warn(`[sessions] session ${sessionId}: summary failed: ${message}`);
    return finish({ summaryStatus: 'failed' });
  };

  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { tenant: { select: { id: true, name: true, industryLabel: true } } }
    });
    if (!session) return null;

    const leads = await prisma.lead.findMany({ where: { tenantId: session.tenantId, sessionId }, select: { id: true } });
    if (leads.length) {
      for (const { id } of leads) scheduleLeadSummary(id, 0);
      return null;
    }

    const transcript = await loadTranscript({ tenantId: session.tenantId, sessionId });
    if (transcript.length < MIN_MESSAGES) return finish({ summaryStatus: 'none' });
    if (!isLlmConfigured()) return fail('no LLM provider is configured');

    await prisma.chatSession.update({ where: { id: sessionId }, data: { summaryStatus: 'pending' } });
    const botType = session.botType || transcript.find((m) => m.botType)?.botType || 'support';
    const { text, provider, model, usage } = await generateAnswer(
      buildSummaryPrompt({ tenant: session.tenant, botType, transcript, hasLead: false })
    );
    // Platform work billed to the tenant, like lead summaries (services/leads.js).
    await logUsage({ ctx: { tenantId: session.tenantId }, provider, model, usage });
    const summary = cleanSummary(text);
    if (!summary) return fail('the model returned an empty summary');
    return await finish({ summary, summaryStatus: 'ready' });
  } catch (err) {
    return fail(err.attempts ? formatAttempts(err.attempts) : err.message);
  }
}

/** Fire-and-forget. Coalesces with a run already in progress. */
function runSessionSummary(sessionId) {
  const current = running.get(sessionId);
  if (current) {
    current.rerun = true;
    return;
  }
  const state = { rerun: false };
  running.set(sessionId, state);
  (async () => {
    try {
      do {
        state.rerun = false;
        await summarizeSession(sessionId);
      } while (state.rerun);
    } finally {
      running.delete(sessionId);
    }
  })();
}

/**
 * The widget reports the page closed: mark the conversation ended and
 * summarize it now rather than after the idle delay.
 * @returns {Promise<boolean>} false when there's no such session for this tenant
 */
async function endSession({ tenantId, sessionId }) {
  const { count } = await prisma.chatSession.updateMany({
    where: { id: sessionId, tenantId, endedAt: null }, data: { endedAt: new Date() }
  });
  if (!count) {
    // Already ended, or not this tenant's: only the former is a real session.
    return !!(await prisma.chatSession.findFirst({ where: { id: sessionId, tenantId }, select: { id: true } }));
  }
  runSessionSummary(sessionId);
  return true;
}

/**
 * Idle conversations whose summary is missing or older than their last
 * message, active within LOOKBACK_HOURS, oldest activity first. A failed
 * attempt sets summarizedAt too (here and in services/leads.js), so it's
 * retried only once new messages arrive. summaryStatus "pending" is not
 * excluded: a run cut short by a restart would otherwise never be retried;
 * the in-process `running` map keeps one process from doubling up.
 */
async function findSessionsToSummarize({ limit = SWEEP_BATCH } = {}) {
  const idleBefore = new Date(Date.now() - SUMMARY_IDLE_MS);
  const after = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw`
    SELECT s.id FROM "ChatSession" s
    JOIN "Tenant" t ON t.id = s."tenantId" AND t.active
    WHERE s."messageCount" >= ${MIN_MESSAGES}
      AND s."lastMessageAt" > ${after} AND s."lastMessageAt" <= ${idleBefore}
      AND (s."summarizedAt" IS NULL OR s."summarizedAt" < s."lastMessageAt")
    ORDER BY s."lastMessageAt" ASC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

async function sweep() {
  try {
    if (!isLlmConfigured()) return 0;
    const ids = (await findSessionsToSummarize()).filter((id) => !running.has(id));
    for (const id of ids) runSessionSummary(id);
    return ids.length;
  } catch (err) {
    console.warn(`[sessions] summary sweep failed: ${err.message}`);
    return 0;
  }
}

/** Starts the background sweep. Returns a stop function. Not started in tests. */
function startSessionSummaryWorker() {
  const timer = setInterval(sweep, SWEEP_MS);
  timer.unref?.();
  console.log(`[sessions] summary worker: every ${SWEEP_MS / 1000}s, conversations idle ${SUMMARY_IDLE_MS / 1000}s+`);
  return () => clearInterval(timer);
}

module.exports = {
  recordTurn,
  summarizeSession,
  runSessionSummary,
  endSession,
  findSessionsToSummarize,
  sweep,
  startSessionSummaryWorker,
  SUMMARY_IDLE_MS,
  MIN_MESSAGES
};
