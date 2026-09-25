const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createIpRateLimiter } = require('../src/utils/ipRateLimit');

describe('createIpRateLimiter', () => {
  test('allows up to max requests within the window, then blocks the next one', () => {
    const isLimited = createIpRateLimiter({ max: 3, windowMs: 60000 });
    assert.equal(isLimited('1.2.3.4'), false);
    assert.equal(isLimited('1.2.3.4'), false);
    assert.equal(isLimited('1.2.3.4'), false);
    assert.equal(isLimited('1.2.3.4'), true); // 4th call in the window
  });

  test('tracks each IP independently', () => {
    const isLimited = createIpRateLimiter({ max: 1, windowMs: 60000 });
    assert.equal(isLimited('1.1.1.1'), false);
    assert.equal(isLimited('2.2.2.2'), false); // a different IP is not affected by the first one's usage
    assert.equal(isLimited('1.1.1.1'), true);
    assert.equal(isLimited('2.2.2.2'), true);
  });

  test('a missing/falsy IP is bucketed under a stable key rather than throwing', () => {
    const isLimited = createIpRateLimiter({ max: 1, windowMs: 60000 });
    assert.equal(isLimited(undefined), false);
    assert.equal(isLimited(undefined), true);
    assert.equal(isLimited(null), true); // same bucket as undefined
  });

  test('two independently-created limiters do not share state', () => {
    const a = createIpRateLimiter({ max: 1, windowMs: 60000 });
    const b = createIpRateLimiter({ max: 1, windowMs: 60000 });
    assert.equal(a('9.9.9.9'), false);
    assert.equal(b('9.9.9.9'), false); // b's own budget, unaffected by a's usage
  });
});
