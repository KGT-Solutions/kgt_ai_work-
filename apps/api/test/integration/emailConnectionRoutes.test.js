process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-email';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'g-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g-secret';
process.env.MICROSOFT_OAUTH_CLIENT_ID = 'm-client';
process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'm-secret';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const prisma = require('../../src/lib/prisma');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');
const emailOAuthRouter = require('../../src/routes/emailOAuth.routes');
const { signToken } = require('../../src/utils/authTokens');
const teamAlerts = require('../../src/services/teamAlerts');
const { resetStore } = require('../../src/lib/sharedStore');

// Feature 10 over HTTP: the dashboard /email-connection endpoints, the public
// OAuth callback (with the provider token exchange stubbed on global fetch),
// and that a tenant toggle is actually enforced before a category email sends.

const TENANT = { id: 'tenant-oauth', slug: 'acme', name: 'Acme', active: true };
let row, server, base;
const realFetch = globalThis.fetch;
const realFind = prisma.tenantEmailSettings;
const jwtWith = (c) => ['h', Buffer.from(JSON.stringify(c)).toString('base64url'), 's'].join('.');
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });

before(async () => {
  prisma.tenantEmailSettings = {
    findUnique: async ({ where, select }) => {
      if (where.tenantId !== TENANT.id || !row) return null;
      if (select) return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      return { ...row };
    },
    upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { id: 'e1', tenantId: TENANT.id, ...create }; return { ...row }; },
    update: async ({ data }) => { row = { ...row, ...data }; return { ...row }; }
  };
  // The provider token exchange (completeConnect → emailOAuth.exchangeCode).
  globalThis.fetch = async (url) => {
    if (/oauth2\.googleapis\.com\/token/.test(String(url))) {
      return resp({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'gmail.send', id_token: jwtWith({ email: 'owner@acme.com' }) });
    }
    return resp({}, 200);
  };

  const app = express();
  app.use(express.json());
  app.use('/ws', (req, _res, next) => { req.tenant = TENANT; req.actor = 'client'; req.tenantUser = { email: 'owner@acme.com' }; next(); }, workspaceRouter);
  app.use('/pub/email', emailOAuthRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); globalThis.fetch = realFetch; prisma.tenantEmailSettings = realFind; });
beforeEach(() => { row = null; resetStore(); });

// Use the REAL fetch for the test's own HTTP calls — globalThis.fetch is
// stubbed (above) only to intercept the app's internal provider token exchange.
const call = (path, { method = 'GET', body } = {}) => realFetch(`${base}${path}`, {
  method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined
});

describe('GET /email-connection', () => {
  test('reports configured providers, not connected, toggles on', async () => {
    const s = await (await call('/ws/email-connection')).json();
    assert.equal(s.connected, false);
    assert.equal(s.providers.google.configured, true);
    assert.deepEqual(s.toggles, { leadAlerts: true, attentionAlerts: true, visitorConfirmation: true });
  });
});

describe('POST /email-connection/connect', () => {
  test('returns a consent URL for a configured provider', async () => {
    const res = await call('/ws/email-connection/connect', { method: 'POST', body: { provider: 'google' } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.authUrl, /accounts\.google\.com/);
    assert.ok(new URL(body.authUrl).searchParams.get('state'), 'carries a signed state');
  });

  test('an unknown provider is a 400', async () => {
    assert.equal((await call('/ws/email-connection/connect', { method: 'POST', body: { provider: 'yahoo' } })).status, 400);
  });
});

describe('the public OAuth callback', () => {
  test('exchanges the code and stores the connection, which status then reflects', async () => {
    const state = signToken('email_oauth', { tenantId: TENANT.id, provider: 'google', actor: 'owner@acme.com' });
    // No DASHBOARD_URL in the test env → the callback answers JSON instead of redirecting.
    const res = await call(`/pub/email/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.email, 'connected');
    const status = await (await call('/ws/email-connection')).json();
    assert.equal(status.connected, true);
    assert.equal(status.provider, 'google');
    assert.equal(status.email, 'owner@acme.com');
  });

  test('a tampered/invalid state is reported as an error, not a 500', async () => {
    const res = await call('/pub/email/google/callback?code=abc&state=not-a-real-state');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).email, 'error');
  });
});

describe('PUT /email-connection/toggles — enforced before a category sends', () => {
  test('turning "new lead alerts" off makes teamAlerts skip the email (lead still kept)', async () => {
    const saved = await (await call('/ws/email-connection/toggles', { method: 'PUT', body: { leadAlerts: false } })).json();
    assert.equal(saved.toggles.leadAlerts, false);
    // The actual enforcement: notifyLeadCaptured returns disabled-by-tenant and never tries to send.
    const result = await teamAlerts.notifyLeadCaptured({ tenant: TENANT, lead: { id: 'l1', botType: 'sales', email: 'v@x.com', sessionId: 's1' } });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'disabled-by-tenant');
  });
});
