const { store, keys } = require('../lib/sharedStore');
const { ipBucket } = require('../services/shared/netGuard');

// Sliding-window abuse limiter, keyed by whatever string the caller has to
// limit on: an IP for the public endpoints that have no identity yet, an email
// address for the ones that send mail, a tenant id for the ones that spend a
// company's LLM budget.
//
// The window now lives in lib/sharedStore.js rather than in a Map per limiter.
// With one API container that is the same behaviour; with several it is the
// difference between a limit that holds and one that is quietly N times
// looser, because each instance would otherwise count only the traffic it
// happened to receive.
//
// `name` is REQUIRED and must be unique per limiter. The store is one flat
// keyspace, so two limiters sharing a name would share a bucket — sign-in
// attempts would eat into the signup-code allowance for the same IP. It is
// also what makes a key readable when looking at the store directly
// (rl:client-login:198.51.100.4).
//
// The returned function is ASYNC: a networked driver cannot answer
// synchronously. Callers must await it, including inside Express middleware
// (wrapRouterAsync in app.js forwards a rejected middleware to the error
// handler, so an async middleware in a route is safe).

/**
 * @param {{ max: number, windowMs: number, name: string }} opts
 *   max: hits allowed per window — the (max + 1)th is limited.
 * @returns {(subject: string) => Promise<boolean>} true when the caller is over the limit
 */
function createIpRateLimiter({ max, windowMs, name }) {
  if (!name) throw new Error('createIpRateLimiter requires a unique `name`: limiters share one keyspace');
  return async function isRateLimited(subject) {
    // An IP subject is bucketed: an IPv6 client usually holds a whole /64 and
    // could rotate through it to dodge any per-address limit, so the /64 is
    // the unit. Emails, tenant ids and other subjects pass through unchanged.
    const count = await store().incrWindow(keys.rateLimit(name, ipBucket(subject || 'unknown')), windowMs);
    return count > max;
  };
}

module.exports = { createIpRateLimiter };
