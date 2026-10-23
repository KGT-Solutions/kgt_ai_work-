const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createIpRateLimiter } = require('../../src/utils/ipRateLimit');
const { store, resetStore } = require('../../src/lib/sharedStore');

// The limiter now counts in lib/sharedStore.js instead of a Map of its own, so
// it is async and its `name` is what separates one limiter from another. These
// tests cover both: the window behaviour callers depend on, and the isolation
// that used to come free from each limiter owning its state.

beforeEach(async () => {
  resetStore();
  await store().reset();
});

describe('createIpRateLimiter', () => {
  test('allows up to max requests within the window, then blocks the next one', async () => {
    const isLimited = createIpRateLimiter({ name: 't1', max: 3, windowMs: 60000 });
    assert.equal(await isLimited('1.2.3.4'), false);
    assert.equal(await isLimited('1.2.3.4'), false);
    assert.equal(await isLimited('1.2.3.4'), false);
    assert.equal(await isLimited('1.2.3.4'), true); // 4th call in the window
  });

  test('tracks each IP independently', async () => {
    const isLimited = createIpRateLimiter({ name: 't2', max: 1, windowMs: 60000 });
    assert.equal(await isLimited('1.1.1.1'), false);
    assert.equal(await isLimited('2.2.2.2'), false); // a different IP is not affected by the first one's usage
    assert.equal(await isLimited('1.1.1.1'), true);
    assert.equal(await isLimited('2.2.2.2'), true);
  });

  test('a missing/falsy IP is bucketed under a stable key rather than throwing', async () => {
    const isLimited = createIpRateLimiter({ name: 't3', max: 1, windowMs: 60000 });
    assert.equal(await isLimited(undefined), false);
    assert.equal(await isLimited(undefined), true);
    assert.equal(await isLimited(null), true); // same bucket as undefined
  });

  test('limiters with different names do not share a bucket, even for the same subject', async () => {
    // This used to be free: each limiter had its own Map. Now they share one
    // keyspace, so the name is load-bearing — without it, sign-in attempts
    // would eat into the signup-code allowance for the same IP.
    const a = createIpRateLimiter({ name: 'sign-in', max: 1, windowMs: 60000 });
    const b = createIpRateLimiter({ name: 'signup-code', max: 1, windowMs: 60000 });
    assert.equal(await a('9.9.9.9'), false);
    assert.equal(await b('9.9.9.9'), false); // b's own budget, unaffected by a's usage
    assert.equal(await a('9.9.9.9'), true);
    assert.equal(await b('9.9.9.9'), true);
  });

  test('two limiters sharing a name DO share the bucket — which is why the name is required', async () => {
    const a = createIpRateLimiter({ name: 'same', max: 1, windowMs: 60000 });
    const b = createIpRateLimiter({ name: 'same', max: 1, windowMs: 60000 });
    assert.equal(await a('8.8.8.8'), false);
    assert.equal(await b('8.8.8.8'), true, 'the second limiter sees the first one\'s hit');
  });

  test('a limiter built without a name is refused outright, rather than silently colliding', () => {
    assert.throws(() => createIpRateLimiter({ max: 1, windowMs: 60000 }), /requires a unique `name`/);
  });

  test('hits older than the window stop counting', async () => {
    const isLimited = createIpRateLimiter({ name: 't4', max: 2, windowMs: 40 });
    assert.equal(await isLimited('7.7.7.7'), false);
    assert.equal(await isLimited('7.7.7.7'), false);
    assert.equal(await isLimited('7.7.7.7'), true);
    await new Promise((resolve) => setTimeout(resolve, 60)); // the window rolls past
    assert.equal(await isLimited('7.7.7.7'), false, 'the window is sliding, not a fixed quota');
  });
});
