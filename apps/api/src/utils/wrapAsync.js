// Express 4 does not catch a rejected promise returned by an
// `async (req, res) => {}` handler — it becomes an unhandled rejection and,
// with no process-level handler, can take the whole server down over a
// single transient DB error. wrapAsync forwards any thrown/rejected error to
// Express's own error middleware (app.js's final app.use((err,...)=>{})) via
// next(err), exactly like a synchronous throw already would.
function wrapAsync(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Applies wrapAsync to every middleware/handler already registered on a
// router, so every route file gets this safety net without having to
// remember to wrap each handler by hand (and without missing one when a new
// route is added later). Safe to apply to synchronous middleware too — if
// the wrapped function doesn't return a rejected promise, .catch(next) is
// simply never called.
function wrapRouterAsync(router) {
  router.stack.forEach((layer) => {
    if (layer.route) {
      layer.route.stack.forEach((routeLayer) => {
        routeLayer.handle = wrapAsync(routeLayer.handle);
      });
    }
  });
  return router;
}

module.exports = { wrapAsync, wrapRouterAsync };
