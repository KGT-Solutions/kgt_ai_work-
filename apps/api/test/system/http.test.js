const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, loadStack, startServer, http } = require('../support/realStack');

// The complete application, as deployed (src/app.js + real database): the
// HTTP contract every client relies on — health, errors as JSON with no
// internals, body limits, CORS per audience, auth on every protected prefix.

describe('system: HTTP contract', { skip: skipReason }, () => {
  let server, prisma;
  before(async () => {
    const stack = loadStack();
    prisma = stack.prisma;
    server = await startServer(stack.app);
  });
  after(async () => {
    await server?.close();
    await prisma?.$disconnect();
  });

  test('GET /health answers 200 { status: ok }', async () => {
    const r = await http(server.base, 'GET', '/health');
    assert.deepEqual([r.status, r.body], [200, { status: 'ok' }]);
  });

  test('an unknown API path is a JSON 404, not an HTML page', async () => {
    const r = await http(server.base, 'GET', '/api/v1/does-not-exist');
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'Not found' });
  });

  test('malformed JSON is a 400 with a plain message', async () => {
    const r = await http(server.base, 'POST', '/api/v1/client/login', { body: '{"email": ' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Malformed request body/);
  });

  test('a body over the 10MB limit is a 413', async () => {
    const r = await http(server.base, 'POST', '/api/v1/client/login', { body: JSON.stringify({ email: 'x'.repeat(11 * 1024 * 1024) }) });
    assert.equal(r.status, 413);
  });

  test('every protected prefix refuses a request with no session', async () => {
    for (const path of ['/api/v1/tenants', '/api/v1/client/workspace/documents', '/api/v1/client/me', '/api/v1/operator/me']) {
      const r = await http(server.base, 'GET', path);
      assert.equal(r.status, 401, path);
      assert.equal(typeof r.body.error, 'string', path);
    }
    const chat = await http(server.base, 'POST', '/api/v1/tenant-chat/no-such-company/chat', { body: { query: 'hi' } });
    assert.equal(chat.status, 404);
  });

  test('a forged or expired token is refused', async () => {
    const r = await http(server.base, 'GET', '/api/v1/client/me', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJjbGllbnQifQ.forged' });
    assert.equal(r.status, 401);
  });

  test('CORS: the widget API answers any origin; dashboard APIs only the web app\'s', async () => {
    const widget = await http(server.base, 'OPTIONS', '/api/v1/tenant-chat/x/chat', { headers: { origin: 'https://customer-site.example', 'access-control-request-method': 'POST' } });
    assert.equal(widget.headers.get('access-control-allow-origin'), '*');
    const dashboard = await http(server.base, 'OPTIONS', '/api/v1/client/login', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(dashboard.headers.get('access-control-allow-origin'), null);
    const allowed = await http(server.base, 'OPTIONS', '/api/v1/client/login', { headers: { origin: 'http://localhost:3100', 'access-control-request-method': 'POST' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3100');
  });

  test('the embeddable widget script is served', async () => {
    const res = await fetch(`${server.base}/widgets/tenant-chat-widget.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
  });
});
