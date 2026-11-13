const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-crm';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const prisma = require('../../src/lib/prisma');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

// GET /crm, POST /crm/connect and POST /crm/disconnect on the workspace router,
// scoped to req.tenant. The CRM tables are in-memory stubs.

const TENANT_ID = 'tenant-crm';
let integration, logs, deleted;
let server, base, envPrev;

before(async () => {
  envPrev = { id: process.env.ZOHO_CLIENT_ID, secret: process.env.ZOHO_CLIENT_SECRET };
  process.env.ZOHO_CLIENT_ID = 'zoho-client';
  process.env.ZOHO_CLIENT_SECRET = 'zoho-secret';

  prisma.tenantCRMIntegration = {
    findUnique: async ({ where }) => (where.tenantId === TENANT_ID ? integration : null),
    upsert: async ({ update }) => { integration = { ...(integration || { tenantId: TENANT_ID }), ...update }; return integration; },
    deleteMany: async ({ where }) => { if (where.tenantId === TENANT_ID) { deleted = true; integration = null; } return { count: 1 }; }
  };
  prisma.cRMSyncLog = { findMany: async () => logs };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenant = { id: TENANT_ID }; req.actor = 'client'; req.protocol = 'https'; next(); });
  app.use('/', workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  if (envPrev.id === undefined) delete process.env.ZOHO_CLIENT_ID; else process.env.ZOHO_CLIENT_ID = envPrev.id;
  if (envPrev.secret === undefined) delete process.env.ZOHO_CLIENT_SECRET; else process.env.ZOHO_CLIENT_SECRET = envPrev.secret;
});

beforeEach(() => { integration = null; logs = []; deleted = false; });

describe('GET /crm', () => {
  test('reports not-connected with the region options when nothing is set up', async () => {
    const res = await fetch(`${base}/crm`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.connected, false);
    assert.equal(body.provider, 'ZOHO');
    assert.ok(body.regions.includes('in'));
    assert.equal(body.configured, true);
  });
});

describe('POST /crm/connect', () => {
  test('returns a Zoho consent URL for the chosen region and stores it', async () => {
    const res = await fetch(`${base}/crm/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ region: 'in' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.match(body.authUrl, /accounts\.zoho\.in\/oauth\/v2\/auth/);
    assert.equal(integration.region, 'in');
  });

  test('an unsupported region is a 400', async () => {
    const res = await fetch(`${base}/crm/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ region: 'nowhere' })
    });
    assert.equal(res.status, 400);
  });
});

describe('POST /crm/disconnect', () => {
  test('removes the connection', async () => {
    integration = { tenantId: TENANT_ID, region: 'in', refreshToken: 'cipher', isEnabled: true };
    const res = await fetch(`${base}/crm/disconnect`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.connected, false);
    assert.equal(deleted, true);
  });
});
