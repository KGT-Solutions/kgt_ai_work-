const { logger } = require('../lib/logger');

// One structured line per request when it finishes: method, path, status and
// duration, tagged with the request's correlation id. This is the access log the
// logger was built for — it turns "something was slow / returned 500 at 14:02"
// into a line you can grep by reqId and join to everything else that request
// logged.
//
// Registered right after middleware/requestId.js (app.js), so req.id exists and
// the timer spans the whole request. ACCESS_LOG_ENABLED=false turns it off.
//
// The reqId is read from req.id and passed explicitly rather than left to the
// logger's async context: the 'finish' event fires outside the request's
// synchronous flow, where that context is not guaranteed to still be active.
// The PATH only (never req.originalUrl) is logged, so a token in a query string
// (reset links, signed URLs) never lands in the access log.

const enabled = () => String(process.env.ACCESS_LOG_ENABLED || '').toLowerCase() !== 'false';

// Health probes hit constantly and say nothing useful; one line each would bury
// the real traffic.
const SKIP = new Set(['/health']);

function accessLog(req, res, next) {
  if (!enabled() || SKIP.has(req.path)) return next();

  const start = process.hrtime.bigint();
  let logged = false;
  const emit = () => {
    if (logged) return; // 'close' always follows 'finish'; log the request once
    logged = true;
    const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const status = res.statusCode;
    // A request the client gave up on before the response finished: res never
    // reached writableEnded. Surfacing it (rather than dropping it) is the point
    // of also listening for 'close'.
    const aborted = !res.writableEnded;
    // Always info: this is the access log, one line per request, and the status
    // field is what you filter on. Server-error *detail* (the stack) is logged
    // separately at error level by middleware/errorHandler.js, so this line does
    // not double as a second error for the same request.
    logger.info('request', {
      reqId: req.id,
      method: req.method,
      path: req.path,
      status,
      durationMs,
      ...(aborted ? { aborted: true } : {}),
    });
  };

  // 'finish' = response sent normally; 'close' = connection closed, including a
  // client disconnect before 'finish' ever fired. The `logged` guard keeps it to
  // one line when both fire.
  res.on('finish', emit);
  res.on('close', emit);

  next();
}

module.exports = { accessLog };
