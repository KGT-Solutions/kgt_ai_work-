const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { corsPolicy, allowedOrigins, isPublicPath, DEV_ORIGINS } = require('../src/utils/corsPolicy');

describe('corsPolicy — open for the widget, web-app-only for everything else', () => {
  test('allowedOrigins parses CORS_ORIGINS and falls back to the local dev origins', () => {
    assert.deepEqual(allowedOrigins({ CORS_ORIGINS: ' https://a.example.com/ , https://b.example.com ' }),
      ['https://a.example.com', 'https://b.example.com']);
    assert.deepEqual(allowedOrigins({}), DEV_ORIGINS);
  });

  test('only the widget, its chat API and /health are public', () => {
    assert.ok(isPublicPath('/widgets/tenant-chat-widget.js'));
    assert.ok(isPublicPath('/api/v1/tenant-chat/acme/chat'));
    assert.ok(isPublicPath('/health'));
    assert.ok(!isPublicPath('/api/v1/client/login'));
    assert.ok(!isPublicPath('/api/v1/tenants'));
    assert.ok(!isPublicPath('/api/v1/tenant-chatx/acme/chat'));
  });

  let server;
  let base;
  before(async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(corsPolicy({ CORS_ORIGINS: 'https://hub.example.com' }));
    app.all('*', (req, res) => res.json({ ip: req.ip }));
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const preflight = (path, origin) => fetch(base + path, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });

  test('a customer site can call the widget chat API', async () => {
    const r = await preflight('/api/v1/tenant-chat/acme/chat', 'https://any-customer.example.org');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
  });

  test('the web app origin can call dashboard and staff APIs', async () => {
    for (const path of ['/api/v1/client/workspace/documents', '/api/v1/tenants', '/api/v1/client/login']) {
      const r = await preflight(path, 'https://hub.example.com');
      assert.equal(r.headers.get('access-control-allow-origin'), 'https://hub.example.com', path);
    }
  });

  test('any other origin gets no CORS grant on dashboard and staff APIs', async () => {
    for (const path of ['/api/v1/client/workspace/documents', '/api/v1/tenants', '/api/v1/public/register/complete']) {
      const r = await preflight(path, 'https://evil.example.net');
      assert.equal(r.headers.get('access-control-allow-origin'), null, path);
    }
  });

  test('with trust proxy, req.ip is the client from X-Forwarded-For, not the proxy', async () => {
    const r = await fetch(`${base}/api/v1/client/login`, { headers: { 'X-Forwarded-For': '203.0.113.7' } });
    assert.equal((await r.json()).ip, '203.0.113.7');
  });
});
