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
function errorHandler(err, req, res, next) {
  // Headers already sent (e.g. an error mid-stream): let Express close the connection.
  if (res.headersSent) return next(err);

  const status = Number(err?.status ?? err?.statusCode);

  if (err?.type === 'entity.too.large' || status === 413) {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (err?.type === 'entity.parse.failed' || status === 400) {
    return res.status(400).json({ error: 'Malformed request body — expected valid JSON' });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
