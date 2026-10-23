const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DRIVERS, store, resetStore, keys, driverName } = require('../../src/lib/sharedStore');

// ONE contract, run against EVERY registered driver. This is the point of the
// file: the memory driver is what ships today and the Redis driver is what
// makes several API instances behave as one, and the only way they can be
// swapped safely is if both satisfy the same observable behaviour. When the
// Redis driver is added it appears in DRIVERS and is exercised here with no
// new test code — a driver that quietly differs fails right here instead of in
// production, where a looser rate limit or a missed invalidation is invisible.
//
// Deliberately behavioural: nothing below reaches inside a driver.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The Redis driver needs a reachable server, so it is exercised only when one
// is configured: `REDIS_URL=redis://127.0.0.1:6379 npm test`. Without it the
// suite still runs in full against the memory driver, which is what ships by
// default — so the release gate never depends on external infrastructure.
const skipFor = (name) => (name === 'redis' && !process.env.REDIS_URL
  ? 'set REDIS_URL to run the contract against Redis'
  : false);

for (const [name, createDriver] of Object.entries(DRIVERS)) {
  describe(`sharedStore contract — ${name} driver`, { skip: skipFor(name) }, () => {
    let s;
    // One connection for the whole suite, closed at the end: a driver per test
    // would leak a socket per test and leave node unable to exit.
    before(() => { s = createDriver(); });
    after(async () => { await s?.close?.(); });
    beforeEach(async () => { await s.reset(); });

    describe('incrWindow / countWindow (the rate limiters)', () => {
      test('counts each hit, including the one being recorded', async () => {
        assert.equal(await s.incrWindow('a', 1000), 1);
        assert.equal(await s.incrWindow('a', 1000), 2);
        assert.equal(await s.incrWindow('a', 1000), 3);
      });

      test('keys are independent', async () => {
        assert.equal(await s.incrWindow('a', 1000), 1);
        assert.equal(await s.incrWindow('b', 1000), 1);
      });

      test('hits older than the window stop counting — a sliding window, not a fixed quota', async () => {
        assert.equal(await s.incrWindow('a', 40), 1);
        assert.equal(await s.incrWindow('a', 40), 2);
        await sleep(60);
        assert.equal(await s.incrWindow('a', 40), 1, 'the earlier hits have aged out');
      });

      test('countWindow reports without recording, so a peek cannot consume an allowance', async () => {
        await s.incrWindow('a', 1000);
        assert.equal(await s.countWindow('a', 1000), 1);
        assert.equal(await s.countWindow('a', 1000), 1, 'peeking twice must not add hits');
        assert.equal(await s.incrWindow('a', 1000), 2);
      });

      test('countWindow on an untouched key is zero, not an error', async () => {
        assert.equal(await s.countWindow('never-seen', 1000), 0);
      });
    });

    describe('claimOnce (the alert throttles and job locks)', () => {
      test('exactly one caller wins', async () => {
        assert.equal(await s.claimOnce('job', 1000), true);
        assert.equal(await s.claimOnce('job', 1000), false);
        assert.equal(await s.claimOnce('job', 1000), false);
      });

      test('concurrent callers: still exactly one winner', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () => s.claimOnce('race', 1000)));
        assert.equal(results.filter(Boolean).length, 1, `expected one winner, got ${results.filter(Boolean).length}`);
      });

      test('the claim lapses, so a holder that dies does not block the job for ever', async () => {
        assert.equal(await s.claimOnce('job', 30), true);
        await sleep(50);
        assert.equal(await s.claimOnce('job', 30), true, 'an expired claim is re-claimable');
      });

      test('different keys are different claims', async () => {
        assert.equal(await s.claimOnce('job:a', 1000), true);
        assert.equal(await s.claimOnce('job:b', 1000), true);
      });
    });

    describe('get / set / del (the wizard audit hand-off)', () => {
      test('a stored value comes back, structure intact', async () => {
        await s.set('k', { score: 72, bots: { support: ['a', 'b'] } }, 1000);
        assert.deepEqual(await s.get('k'), { score: 72, bots: { support: ['a', 'b'] } });
      });

      test('a missing key is null, not undefined or a throw', async () => {
        assert.equal(await s.get('nope'), null);
      });

      test('a value expires after its TTL', async () => {
        await s.set('k', 'v', 30);
        assert.equal(await s.get('k'), 'v');
        await sleep(50);
        assert.equal(await s.get('k'), null);
      });

      test('del removes it, and deleting twice is not an error', async () => {
        await s.set('k', 'v', 1000);
        await s.del('k');
        assert.equal(await s.get('k'), null);
        await s.del('k');
      });

      test('set overwrites', async () => {
        await s.set('k', 'first', 1000);
        await s.set('k', 'second', 1000);
        assert.equal(await s.get('k'), 'second');
      });
    });

    describe('incr / number (the per-tenant knowledge generation)', () => {
      test('an unseen counter reads zero, so a tenant with no edits needs no setup', async () => {
        assert.equal(await s.number('gen'), 0);
      });

      test('incr returns the new value and is monotonic', async () => {
        assert.equal(await s.incr('gen'), 1);
        assert.equal(await s.incr('gen'), 2);
        assert.equal(await s.number('gen'), 2);
      });

      test('counters are independent per key, so one tenant does not invalidate another', async () => {
        await s.incr('gen:a');
        assert.equal(await s.number('gen:b'), 0);
      });

      test('concurrent incr never loses an increment', async () => {
        await Promise.all(Array.from({ length: 10 }, () => s.incr('gen')));
        assert.equal(await s.number('gen'), 10);
      });

      test('a counter has no TTL — a generation must never silently roll back', async () => {
        await s.incr('gen');
        await sleep(40);
        assert.equal(await s.number('gen'), 1);
      });
    });
  });
}

describe('sharedStore driver selection', () => {
  beforeEach(() => resetStore());

  test('defaults to the in-memory driver, so a single container needs no extra infrastructure', () => {
    delete process.env.SHARED_STORE;
    assert.equal(driverName(), 'memory');
    assert.equal(store().name, 'memory');
  });

  test('an unknown SHARED_STORE fails loudly at first use instead of silently running unshared', () => {
    process.env.SHARED_STORE = 'definitely-not-a-driver';
    assert.throws(() => store(), /Unknown SHARED_STORE/);
    delete process.env.SHARED_STORE;
    resetStore();
  });

  test('the same instance is reused across calls, so state is not rebuilt per caller', () => {
    delete process.env.SHARED_STORE;
    assert.equal(store(), store());
  });
});

describe('sharedStore keyspace', () => {
  test('every concern has its own prefix, so nothing can collide in one keyspace', () => {
    const built = [
      keys.rateLimit('client-login', '1.2.3.4'),
      keys.knowledgeGeneration('t1'),
      keys.alertSession('t1', 's1'),
      keys.alertTenant('t1'),
      keys.wizardAudit('abc123'),
      keys.jobLock('audit', 't1')
    ];
    assert.equal(new Set(built).size, built.length, 'keys must be distinct');
    assert.equal(new Set(built.map((k) => k.split(':')[0])).size, built.length - 1, 'al: is shared by the two alert kinds');
  });

  test('the same inputs always give the same key, and different ones never do', () => {
    assert.equal(keys.knowledgeGeneration('t1'), keys.knowledgeGeneration('t1'));
    assert.notEqual(keys.knowledgeGeneration('t1'), keys.knowledgeGeneration('t2'));
    assert.notEqual(keys.rateLimit('a', 'x'), keys.rateLimit('b', 'x'));
    assert.notEqual(keys.rateLimit('a', 'x'), keys.rateLimit('a', 'y'));
  });
});
