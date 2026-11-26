const app = require('./app');
const { logger } = require('./lib/logger');
const { assertProdSafety, ProdSafetyError } = require('./utils/assertProdSafety');
const { describeLlmConfig, verifyLlmModels } = require('./engine/llmClient');
const { verifyMailer, mailFrom } = require('./services/mailer');
const { confirmationCooldownMs } = require('./services/leads');
const { startSessionSummaryWorker } = require('./services/chatSessions');
const { startRetentionWorker } = require('./services/retention');
const { startKnowledgeSyncWorker } = require('./services/knowledgeSync');
const { describeSharedStore } = require('./lib/sharedStore');
const { notifyError } = require('./services/errorAlerts');

// A config problem gets a readable list of what to fix, not a stack trace.
try {
  assertProdSafety();
} catch (err) {
  if (!(err instanceof ProdSafetyError)) throw err;
  logger.error(`[startup] FATAL: ${err.message}`);
  process.exit(1);
}

// Which shared-store driver is in use, and what that means. The failure this
// guards against is silent: run several API containers with the in-process
// driver and every rate limit is N times looser, a document edited on one
// container never invalidates the others' caches, and two of them pay for the
// same background audit. None of it errors — it just quietly misbehaves.
const sharedStore = describeSharedStore();
if (sharedStore.driver === 'memory') {
  logger.info(
    '[sharedStore] in-process driver: rate limits, knowledge invalidation, alert throttles and job locks ' +
    'are local to THIS process. Correct for a single API container; if you run more than one, set ' +
    'SHARED_STORE=redis and REDIS_URL or they will not agree with each other.'
  );
} else {
  logger.info(`[sharedStore] shared via ${sharedStore.driver} — safe to run several API containers`);
}

// Not fatal (the rest of the API works without an LLM), but loud: with no
// working provider, every chat answer is a "try again later" fallback.
const llm = describeLlmConfig();
if (!llm.configured.length) {
  logger.warn(
    `[llm] WARNING: no API key set for any provider in the chain (${llm.chain.join(' -> ')}). ` +
    `Set ${llm.missingKeys.join(' / ')} — the bots can't answer until then.`
  );
} else if (llm.missingKeys.length) {
  logger.warn(`[llm] chain ${llm.chain.join(' -> ')}: no key for ${llm.missingKeys.join(', ')} (skipped at request time)`);
}

// Catch a retired or inaccessible model at boot rather than on the first chat.
verifyLlmModels().then((results) => {
  for (const r of results) {
    if (r.status === 'ok') logger.info(`[llm] ${r.provider}: model "${r.model}" is available`);
    else if (r.status === 'missing') {
      logger.warn(
        `[llm] WARNING: ${r.provider} model "${r.model}" is not available for this key — chats will skip ${r.provider}. ` +
        `Set ${r.provider.toUpperCase()}_MODEL to one of: ${r.suggestions.join(', ') || '(none listed)'}`
      );
    } else logger.warn(`[llm] could not verify ${r.provider} model "${r.model}": ${r.reason}`);
  }
});

// Same idea for email: a wrong SMTP password otherwise only shows up as
// visitors quietly not getting mail.
verifyMailer().then((m) => {
  if (!m.transport) {
    const log = m.production ? logger.error : logger.warn;
    log(`[mailer] ${m.production ? 'ERROR' : 'WARNING'}: no mail transport configured — ` +
      `${m.production ? 'every email (lead confirmations, password resets) will FAIL' : 'emails are printed to this log, not sent'}\n` +
      `[mailer]   fix: ${m.hint}`);
  } else if (m.ok === false) {
    logger.error(`[mailer] ERROR: SMTP check failed (${m.reason}): ${m.error} — emails will fail until this is fixed\n[mailer]   fix: ${m.hint}`);
  } else {
    logger.info(`[mailer] sending via ${m.transport}${m.ok ? ' (SMTP login OK)' : ''} as ${mailFrom()}`);
  }
  if (m.production && confirmationCooldownMs() === 0) {
    logger.warn('[leads] WARNING: LEAD_CONFIRMATION_COOLDOWN_HOURS=0 in production — every email typed into a chat gets a ' +
      'confirmation, with no anti-spam limit. Remove it once testing is done.');
  }
});

// Last-resort net: wrapRouterAsync (app.js) already forwards every route
// handler's rejections into Express's own error middleware, so this should
// only ever catch something outside the request/response cycle (e.g. a
// fire-and-forget promise). Without it, Node terminates the whole process on
// an uncaught rejection.
process.on('unhandledRejection', (err) => {
  logger.error('[unhandledRejection]', err);
  // Email the operator (throttled; no-op unless ERROR_ALERT_EMAIL is set). The
  // process keeps running, as it did before — a stray rejection is not fatal.
  notifyError(err, { source: 'unhandledRejection' }).catch(() => {});
});

// An uncaughtException leaves the process in an undefined state, so the only
// safe course is to log it, make a best-effort attempt to alert the operator,
// and exit so the orchestrator restarts a clean process (Node's own default is
// to exit here; installing this handler would otherwise suppress that). The
// timeout guarantees we exit even if the alert send hangs on the network.
process.on('uncaughtException', (err) => {
  logger.error('[uncaughtException]', err);
  const bail = () => process.exit(1);
  notifyError(err, { source: 'uncaughtException' }).then(bail, bail);
  setTimeout(bail, 3000).unref();
});

// CORS is configured in app.js via utils/corsPolicy.js (per-path: open for the
// widget, web-app-origins-only for the dashboard, with preflight handled
// there). It is NOT set up here: app.js has already mounted every route, the
// /api JSON 404 and the error handler by the time this file runs, so any
// app.use() added now sits after them and never runs. Change the allowlist in
// corsPolicy.js (and CORS_ORIGINS), not here.

const port = process.env.PORT || 4000;
app.listen(port, () => {
  logger.info(`KGT AI Hub API running at http://localhost:${port}`);
  // Summarizes idle conversations for the Sessions view (services/chatSessions.js).
  // Here, not in app.js, so tests that load the app don't start it.
  startSessionSummaryWorker();
  // Chat-log retention (Feature 16). Fixed 30-day server policy, so the sweep
  // runs by default; set RETENTION_SWEEP_ENABLED=false to pause it.
  startRetentionWorker();
  // Weekly website auto-refresh (Feature 2). Off unless KNOWLEDGE_SYNC_ENABLED=true,
  // so a deployment that hasn't opted in never crawls on its own.
  startKnowledgeSyncWorker();
});