const Redis = require('ioredis');

// The shared driver: makes N API instances behave as one for rate limiting,
// knowledge invalidation, alert throttling and background-job locks. Same
// contract as memoryDriver.js, proven by the single suite both run through
// (test/unit/sharedStore.test.js).
//
// ── Why a client library rather than raw sockets, in a codebase that
// deliberately avoids SDKs (engine/llmClient.js talks to three providers with
// built-in fetch): a sliding window has to be atomic, and reconnection,
// pipelining and error classification are exactly where a hand-rolled RESP
// client goes subtly wrong. A rate limit that silently stops counting, or a
// generation read that silently returns a stale number, is invisible until it
// costs money or serves a customer the wrong facts.
//
// ── WHAT HAPPENS WHEN REDIS IS DOWN is a decision per operation, not one
// global policy, because the right answer differs:
//
//   number()      -> NaN. This is the important one. A generation of NaN
//                    matches nothing, so every cache treats its contents as
//                    invalid: chat keeps working, reads go to the database,
//                    and nothing cached is trusted. Returning 0 would be
//                    unsafe (it could match a real entry and serve content
//                    from documents that have since changed) and throwing
//                    would take chat down over a cache outage.
//   incr()        -> NaN, same reasoning: the bump is lost, so nothing may
//                    rely on having observed it.
//   incrWindow()  -> 0, i.e. rate limiting FAILS OPEN. A limiter that blocks
//                    everything when Redis blips would take every tenant's
//                    widget offline; the provider's own quota and the per-turn
//                    LLM cost remain as backstops. Logged loudly.
//   countWindow() -> 0, consistent with incrWindow.
//   claimOnce()   -> false, i.e. background jobs FAIL CLOSED. Skipping an
//                    audit is cheap and it retries; running it on every
//                    instance at once is a duplicated bill.
//   get/set/del   -> null / no-op. The wizard hand-off degrades to a second
//                    audit, which is exactly what happened before it was shared.

const CONNECT_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 1000;
// One line per failing operation would flood the log while Redis is down.
const LOG_EVERY_MS = 30000;

// Sliding window, atomic. Separate members per hit (a sorted set scored by
// time), so expiry is per hit rather than per key: ZREMRANGEBYSCORE drops the
// ones that have aged out, ZADD records this one, PEXPIRE keeps the key from
// outliving the window, ZCARD is the count. Done in one script because
// between a separate count and add, a parallel request could slip past.
const INCR_WINDOW_LUA = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  return redis.call('ZCARD', KEYS[1])
`;

let hitCounter = 0;

function createRedisDriver() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) throw new Error('SHARED_STORE=redis requires REDIS_URL (e.g. redis://redis:6379)');

  const client = new Redis(url, {
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    // Fail the command instead of queueing it for ever while Redis is down —
    // the fallbacks above depend on getting an error promptly.
    maxRetriesPerRequest: 1,
    // Commands issued before the socket finishes connecting are queued rather
    // than rejected — without this, the very first request after boot fails
    // with "Stream isn't writeable". While Redis is genuinely DOWN the queue
    // is what makes a command wait, so COMMAND_TIMEOUT_MS above is the real
    // bound on how long a degraded operation can hold a request.
    enableOfflineQueue: true,
    lazyConnect: false
  });
  client.defineCommand('incrWindowScript', { numberOfKeys: 1, lua: INCR_WINDOW_LUA });

  let lastLoggedAt = 0;
  client.on('error', (err) => {
    const now = Date.now();
    if (now - lastLoggedAt < LOG_EVERY_MS) return;
    lastLoggedAt = now;
    console.error(
      `[sharedStore] Redis unavailable (${err.message}). Rate limits are failing OPEN, caches are bypassed ` +
      'and background job locks are refused until it returns — see src/lib/sharedStore/redisDriver.js'
    );
  });

  /** Runs a command, returning `fallback` and logging if Redis can't answer. */
  async function guarded(label, fn, fallback) {
    try {
      return await fn();
    } catch (err) {
      const now = Date.now();
      if (now - lastLoggedAt > LOG_EVERY_MS) {
        lastLoggedAt = now;
        console.error(`[sharedStore] Redis ${label} failed (${err.message}); using the degraded fallback`);
      }
      return fallback;
    }
  }

  return {
    name: 'redis',

    async incrWindow(key, windowMs) {
      const now = Date.now();
      // Unique per hit: two hits in the same millisecond must both count, so
      // the member cannot just be the timestamp.
      const member = `${now}-${process.pid}-${(hitCounter = (hitCounter + 1) % 1e6)}`;
      return guarded('incrWindow', async () => {
        const count = await client.incrWindowScript(key, now - windowMs, now, member, windowMs);
        return Number(count) || 0;
      }, 0);
    },

    async countWindow(key, windowMs) {
      // A pure read: ZCOUNT needs no cleanup, since incrWindow prunes and the
      // key carries a TTL of its own.
      return guarded('countWindow', async () => {
        const count = await client.zcount(key, Date.now() - windowMs, '+inf');
        return Number(count) || 0;
      }, 0);
    },

    async claimOnce(key, ttlMs) {
      return guarded('claimOnce', async () => {
        const result = await client.set(key, '1', 'PX', Math.max(1, Math.round(ttlMs)), 'NX');
        return result === 'OK';
      }, false);
    },

    async get(key) {
      return guarded('get', async () => {
        const raw = await client.get(key);
        if (raw === null) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null; // written by something else, or truncated: treat as absent
        }
      }, null);
    },

    async set(key, value, ttlMs) {
      await guarded('set', () => client.set(key, JSON.stringify(value), 'PX', Math.max(1, Math.round(ttlMs))), null);
    },

    async del(key) {
      await guarded('del', () => client.del(key), null);
    },

    async incr(key) {
      return guarded('incr', async () => Number(await client.incr(key)), NaN);
    },

    async number(key) {
      return guarded('number', async () => {
        const raw = await client.get(key);
        return raw === null ? 0 : Number(raw) || 0;
      }, NaN);
    },

    /**
     * Tests only — it empties the whole database. Refused when this looks like
     * a production environment, because a shared Redis may hold more than this
     * app's keys and because flushing live generations would be invisible
     * damage rather than a loud failure.
     */
    async reset() {
      const production = process.env.DEPLOY_ENV === 'production' || process.env.NODE_ENV === 'production';
      if (production) throw new Error('sharedStore reset() refuses to FLUSHDB in production');
      await client.flushdb();
    },

    stats() {
      return { driver: 'redis', status: client.status };
    },

    /** Lets a process (or a test) shut the connection down cleanly. */
    async close() {
      await client.quit().catch(() => client.disconnect());
    }
  };
}

module.exports = { createRedisDriver };
