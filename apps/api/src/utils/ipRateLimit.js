// Small reusable IP-based sliding-window limiter, factored out of the
// per-user/per-tenant version already used by chat.routes.js and
// tenantChat.routes.js — this one keys by IP instead, for endpoints that
// have no authenticated identity to key on at all (the public self-serve
// registration flow below is the first such case).
function createIpRateLimiter({ max, windowMs }) {
  const requestLog = new Map(); // ip -> timestamps[]

  return function isRateLimited(ip) {
    const key = ip || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (requestLog.get(key) || []).filter((t) => t > windowStart);
    timestamps.push(now);
    requestLog.set(key, timestamps);

    if (requestLog.size > 5000 && Math.random() < 0.01) {
      for (const [k, arr] of requestLog) {
        if (!arr.some((t) => t > windowStart)) requestLog.delete(k);
      }
    }

    return timestamps.length > max;
  };
}

module.exports = { createIpRateLimiter };
