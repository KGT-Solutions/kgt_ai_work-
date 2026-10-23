// The in-process driver: exactly the behaviour every one of these caches and
// limiters had when it kept its own Map, so swapping the call sites onto the
// shared store changes nothing while the API runs as a single container.
//
// Correct but NOT shared — with two containers each keeps its own copy, which
// is why every limit would double and a knowledge invalidation on one instance
// would not reach the other. That is what redisDriver.js is for; this driver
// stays the default so a single-container deployment needs no extra infra.

// Keys are swept probabilistically rather than on a timer, as utils/ipRateLimit.js
// always did: a timer would keep the event loop busy for a map that is usually tiny.
const SWEEP_AFTER_KEYS = 5000;
const SWEEP_CHANCE = 0.01;

function createMemoryDriver() {
  const windows = new Map(); // key -> timestamps[]
  const values = new Map(); // key -> { value, expiresAt }
  const counters = new Map(); // key -> number

  const live = (entry) => entry && entry.expiresAt > Date.now();

  function sweepWindows(windowStart) {
    if (windows.size <= SWEEP_AFTER_KEYS || Math.random() >= SWEEP_CHANCE) return;
    for (const [key, stamps] of windows) {
      if (!stamps.some((t) => t > windowStart)) windows.delete(key);
    }
  }

  function sweepValues() {
    if (values.size <= SWEEP_AFTER_KEYS || Math.random() >= SWEEP_CHANCE) return;
    for (const [key, entry] of values) if (!live(entry)) values.delete(key);
  }

  return {
    name: 'memory',

    /** Sliding window: how many hits this key has had in the last windowMs, counting this one. */
    async incrWindow(key, windowMs) {
      const now = Date.now();
      const windowStart = now - windowMs;
      const stamps = (windows.get(key) || []).filter((t) => t > windowStart);
      stamps.push(now);
      windows.set(key, stamps);
      sweepWindows(windowStart);
      return stamps.length;
    },

    /** The same count WITHOUT recording a hit, for callers that peek before acting. */
    async countWindow(key, windowMs) {
      const windowStart = Date.now() - windowMs;
      return (windows.get(key) || []).filter((t) => t > windowStart).length;
    },

    /** True only for the first caller within ttlMs — the throttles and job locks. */
    async claimOnce(key, ttlMs) {
      if (live(values.get(key))) return false;
      values.set(key, { value: 1, expiresAt: Date.now() + ttlMs });
      sweepValues();
      return true;
    },

    async get(key) {
      const entry = values.get(key);
      if (!live(entry)) {
        if (entry) values.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key, value, ttlMs) {
      values.set(key, { value, expiresAt: Date.now() + ttlMs });
      sweepValues();
    },

    async del(key) {
      values.delete(key);
    },

    /** Monotonic counter, no expiry: the per-tenant knowledge generation. */
    async incr(key) {
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      return next;
    },

    async number(key) {
      return counters.get(key) || 0;
    },

    /** Tests only. */
    async reset() {
      windows.clear();
      values.clear();
      counters.clear();
    },

    /** Diagnostics, for /health-style output. */
    stats() {
      return { driver: 'memory', windows: windows.size, values: values.size, counters: counters.size };
    }
  };
}

module.exports = { createMemoryDriver };
