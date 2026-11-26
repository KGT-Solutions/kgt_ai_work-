const crypto = require('node:crypto');
const { runWithRequestContext } = require('../lib/logger');

// Per-request correlation id. It is:
//   - ALWAYS minted server-side, so the id we correlate on is one a client can't
//     choose, reuse or collide — the chat/widget API is public and
//     unauthenticated, so a client-chosen id can't be trusted as the authority;
//   - echoed back as the X-Request-Id response header, so a client (or a crash
//     report, or a support ticket) can be matched to the exact request, and
//   - put into the request's async context (lib/logger.js), so every log line
//     emitted while handling the request is tagged with it.
//
// A sane inbound X-Request-Id (e.g. a trace id from an upstream proxy) is NOT
// adopted as our id; it is recorded alongside as `clientRequestId` so the two can
// still be joined, without letting an untrusted value become the authority.
//
// Register this FIRST in app.js, before helmet/cors/body-parsers, so the context
// wraps the whole request — including body-parser errors that reach the error
// handler via next(err) — and the header is set on every response.
const HEADER = 'X-Request-Id';
// A caller-/proxy-supplied id is only RECORDED (never adopted), and only when
// short and in a safe charset: an attacker-controlled header must not be able to
// inject a newline into our logs or carry an unbounded value.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function requestId(req, res, next) {
  const id = crypto.randomUUID();
  req.id = id;
  res.setHeader(HEADER, id);

  const context = { reqId: id };
  const incoming = req.get(HEADER);
  if (incoming && SAFE_ID.test(incoming)) {
    req.clientRequestId = incoming;
    context.clientRequestId = incoming;
  }

  runWithRequestContext(context, () => next());
}

module.exports = { requestId };
