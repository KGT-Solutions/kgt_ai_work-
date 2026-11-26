// Final Express error handler (registered last in app.js).
//
// Client mistakes that fail before a route runs — mostly express.json()
// body-parser errors — keep their real status instead of becoming a 500:
//   - body over the size limit      -> 413 (err.type 'entity.too.large')
//   - malformed JSON body           -> 400 (err.type 'entity.parse.failed')
// Matching on body-parser's err.type / err.status rather than on
// `err instanceof SyntaxError`: a SyntaxError thrown by our own code (a bad
// JSON.parse on stored data, say) is a server bug and must stay a 500.
// Everything else is a 500 with a generic message — internals are logged,
// never sent to the client.
const { logger } = require('../lib/logger');
const { notifyError } = require('../services/errorAlerts');

// Attach the request's correlation id (middleware/requestId.js) to an error
// body when there is one, so a client or a support ticket can quote the id and
// we can find the matching log line. Omitted when absent (e.g. unit tests that
// exercise this handler without the requestId middleware), keeping those bodies
// unchanged.
function withId(req, payload) {
  return req?.id ? { ...payload, requestId: req.id } : payload;
}

function errorHandler(err, req, res, next) {
  // Headers already sent (e.g. an error mid-stream): let Express close the connection.
  if (res.headersSent) return next(err);

  const status = Number(err?.status ?? err?.statusCode);

  if (err?.type === 'entity.too.large' || status === 413) {
    return res.status(413).json(withId(req, { error: 'Request body is too large' }));
  }
  if (err?.type === 'entity.parse.failed' || status === 400) {
    return res.status(400).json(withId(req, { error: 'Malformed request body — expected valid JSON' }));
  }

  // The request id (if any) is already in the logger's async context, so the
  // line is correlated with the 500 the client just received.
  logger.error(err);
  // Fire-and-forget operator alert (throttled; no-op unless ERROR_ALERT_EMAIL is
  // set). Never awaited and never allowed to reject, so it can't delay or break
  // the response the client is owed.
  notifyError(err, { source: 'http-500', req }).catch(() => {});
  res.status(500).json(withId(req, { error: 'Internal server error' }));
}

module.exports = { errorHandler };
