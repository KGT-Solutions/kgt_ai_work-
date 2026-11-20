const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../src/app');

// Helmet is wired in src/app.js. These assert the headers are actually emitted and
// that the one relaxed policy (CORP: cross-origin) is in place so the embeddable
// widget still loads cross-site. No database is touched.

describe('security headers (helmet)', () => {
  let server, base;
  before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  test('API responses carry standard security headers', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(
      res.headers.get('x-frame-options') || res.headers.get('content-security-policy'),
      'clickjacking protection (X-Frame-Options or CSP frame-ancestors) is present'
    );
  });

  test('Cross-Origin-Resource-Policy is cross-origin so the widget is not blocked cross-site', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });

  test('the embeddable widget script is served and CORP-loadable', async () => {
    const res = await fetch(`${base}/widgets/tenant-chat-widget.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });
});
