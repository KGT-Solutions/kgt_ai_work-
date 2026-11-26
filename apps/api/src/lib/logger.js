// Zero-dependency structured logger with per-request correlation.
//
// Two problems this solves over bare console.*:
//   1. Correlation — every line emitted while handling a request carries the
//      same request id (set by middleware/requestId.js), without threading the
//      id through every function call. An AsyncLocalStorage store holds it and
//      follows the request across awaits.
//   2. Shape — one JSON object per line in production (LOG_FORMAT=json, or the
//      default when NODE_ENV=production), so a log shipper can parse and index
//      it; readable lines in development.
//
// Usage:
//   const { logger } = require('../lib/logger');
//   logger.info('lead captured', { tenantId, leadId });
//   logger.error('send failed', err);          // Error -> { err: {message, stack, ...} }
//
// Config (read per call, so tests and a running process can change them):
//   LOG_LEVEL    debug | info | warn | error     [default info]
//   LOG_FORMAT   json | pretty                    [default: json in production, pretty otherwise]

const { AsyncLocalStorage } = require('node:async_hooks');

// Holds the context (chiefly { reqId }) for the request currently being handled.
const requestContext = new AsyncLocalStorage();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold() {
  return LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
}

// JSON one-object-per-line for machines; readable lines for humans.
function jsonMode() {
  const fmt = String(process.env.LOG_FORMAT || '').toLowerCase();
  if (fmt === 'json') return true;
  if (fmt === 'pretty') return false;
  return process.env.NODE_ENV === 'production';
}

function currentContext() {
  const store = requestContext.getStore();
  return store ? { ...store } : {};
}

// JSON.stringify throws on circular references and BigInt — fatal for a logger,
// which is called from catch blocks and hot paths all over the codebase and must
// never throw. This replacer coerces BigInt to a string and replaces a circular
// reference with "[Circular]" instead of blowing up. (A property getter that
// throws during serialization is still caught by emit's own try/catch below.)
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

// Errors don't JSON.stringify usefully (message/stack are non-enumerable), so
// pull the fields we want by hand. Keep code/status when present.
function serializeError(err) {
  if (!(err instanceof Error)) return err;
  const out = { name: err.name, message: err.message, stack: err.stack };
  if (err.code !== undefined) out.code = err.code;
  if (err.status !== undefined) out.status = err.status;
  if (err.statusCode !== undefined) out.statusCode = err.statusCode;
  return out;
}

function emit(level, args) {
  if (LEVELS[level] < threshold()) return;

  // A log call must never throw (it runs in catch blocks and hot paths), so the
  // whole body is guarded; on any failure we fall back to a minimal line rather
  // than propagate.
  try {
    // Split the call's arguments into a single message string and structured
    // fields (plain objects merged; an Error becomes `err`). Mirrors how
    // console.* is called today, so the Phase 3b sweep is close to mechanical.
    const ctx = currentContext();           // request context (reqId, tenantId, ...)
    const fields = {};                       // caller-supplied fields only
    let msg;
    for (const arg of args) {
      if (arg instanceof Error) {
        fields.err = serializeError(arg);
        if (msg === undefined) msg = arg.message;
      } else if (typeof arg === 'string') {
        msg = msg === undefined ? arg : `${msg} ${arg}`;
      } else if (Array.isArray(arg)) {
        // Collect array args under `details` rather than Object.assign-ing them,
        // which would spread an array into bogus index keys ({0:..,1:..}).
        (fields.details || (fields.details = [])).push(...arg);
      } else if (arg && typeof arg === 'object') {
        Object.assign(fields, arg);
      } else if (arg !== undefined) {
        msg = msg === undefined ? String(arg) : `${msg} ${String(arg)}`;
      }
    }

    const time = new Date().toISOString();
    // Route each level to the SAME-NAMED console method (read here, at call time,
    // so a test's console spy is honoured): error/warn to stderr, info/debug to
    // stdout — the same streams console uses, and the same method each call site
    // used before it moved onto the logger, so swapping console.* for logger.*
    // doesn't change which console method fires.
    const sink = (level === 'error' && console.error)
      || (level === 'warn' && console.warn)
      || (level === 'debug' && console.debug)
      || console.log;

    if (jsonMode()) {
      // Context and the envelope keys are spread LAST, so a caller- (or
      // attacker-) supplied field named level/time/msg/reqId can't shadow the
      // real one and corrupt the record used for filtering and alerting.
      sink(safeStringify({ ...fields, ...ctx, level, time, msg: msg ?? '' }));
      return;
    }

    // Readable single line (one sink call, so "one log per event" holds): the
    // error stack is appended to the same line rather than logged separately.
    const { err, ...callerRest } = fields;
    // Context wins over caller fields of the same name; reqId goes in the prefix,
    // not the trailing object.
    const rest = { ...callerRest, ...ctx };
    const reqId = rest.reqId;
    delete rest.reqId;
    const rid = reqId ? ` [${reqId}]` : '';
    let line = `${time} ${level.toUpperCase().padEnd(5)}${rid} ${msg ?? ''}`;
    if (Object.keys(rest).length) line += ` ${safeStringify(rest)}`;
    if (err) line += `\n${err.stack || `${err.name}: ${err.message}`}`;
    sink(line);
  } catch (e) {
    try { console.error(`[logger] failed to emit a ${level} log: ${e && e.message}`); } catch { /* nothing more we can do */ }
  }
}

const logger = {
  debug: (...args) => emit('debug', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
};

// Run `fn` (and everything it awaits) with the given request context in scope.
function runWithRequestContext(context, fn) {
  return requestContext.run({ ...context }, fn);
}

// Add fields to the current request's context (e.g. auth middleware tagging in
// tenantId once it's known). No-op outside a request.
function addContext(fields) {
  const store = requestContext.getStore();
  if (store) Object.assign(store, fields);
}

// A copy, so callers read context without being able to mutate the live store
// out from under the request (use addContext to add fields deliberately).
function getContext() {
  const store = requestContext.getStore();
  return store ? { ...store } : undefined;
}

function getRequestId() {
  const store = requestContext.getStore();
  return store ? store.reqId : undefined;
}

module.exports = {
  logger,
  runWithRequestContext,
  addContext,
  getContext,
  getRequestId,
  LEVELS,
};
