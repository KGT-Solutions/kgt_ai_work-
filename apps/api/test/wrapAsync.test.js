const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { wrapAsync, wrapRouterAsync } = require('../src/utils/wrapAsync');

function fakeReq() {
  return {};
}
function fakeRes() {
  return {};
}

describe('wrapAsync', () => {
  test('forwards a rejected promise to next(err) instead of throwing unhandled', async () => {
    const boom = new Error('db blip');
    const handler = async () => { throw boom; };
    let caughtErr;
    const next = (err) => { caughtErr = err; };

    await wrapAsync(handler)(fakeReq(), fakeRes(), next);
    assert.equal(caughtErr, boom);
  });

  test('does not call next() at all when the handler resolves normally', async () => {
    const handler = async (req, res) => { res.sent = true; };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    const res = fakeRes();

    await wrapAsync(handler)(fakeReq(), res, next);
    assert.equal(res.sent, true);
    assert.equal(nextCalled, false);
  });

  test('is a harmless pass-through for synchronous middleware that calls next() itself, calling it exactly once', async () => {
    // wrapAsync forwards the very same `next` into fn — it doesn't create a
    // separate one — so a synchronous middleware's own next() call IS the
    // outer next(). The only thing wrapAsync adds is .catch(next) on top,
    // which must stay inert here since nothing rejects.
    let nextCallCount = 0;
    const outerNext = () => { nextCallCount += 1; };
    const syncMiddleware = (req, res, next) => { next(); };

    await wrapAsync(syncMiddleware)(fakeReq(), fakeRes(), outerNext);
    assert.equal(nextCallCount, 1);
  });
});

describe('wrapRouterAsync', () => {
  test('an async route handler that throws is forwarded to next(err), the exact Express-4 gap this closes', async () => {
    const router = express.Router();
    router.get('/boom', async () => {
      throw new Error('rejected in an async handler');
    });
    wrapRouterAsync(router);

    const layer = router.stack[0].route.stack[0];
    let caughtErr;
    await layer.handle(fakeReq(), fakeRes(), (err) => { caughtErr = err; });
    assert.equal(caughtErr.message, 'rejected in an async handler');
  });

  test('every middleware in a multi-middleware route is wrapped, not just the final handler', async () => {
    const router = express.Router();
    router.post(
      '/pay',
      async (req, res, next) => { throw new Error('middleware failure'); },
      async (req, res) => { res.reached = true; }
    );
    wrapRouterAsync(router);

    const [firstLayer] = router.stack[0].route.stack;
    let caughtErr;
    await firstLayer.handle(fakeReq(), fakeRes(), (err) => { caughtErr = err; });
    assert.equal(caughtErr.message, 'middleware failure');
  });

  test('a successful multi-middleware route still reaches the final handler normally', async () => {
    const router = express.Router();
    const calls = [];
    router.get(
      '/ok',
      async (req, res, next) => { calls.push('first'); next(); },
      async (req, res) => { calls.push('second'); }
    );
    wrapRouterAsync(router);

    const [firstLayer, secondLayer] = router.stack[0].route.stack;
    await firstLayer.handle(fakeReq(), fakeRes(), async () => {
      await secondLayer.handle(fakeReq(), fakeRes(), () => {});
    });
    assert.deepEqual(calls, ['first', 'second']);
  });
});
