const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-crm';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const { signToken } = require('../../src/utils/authTokens');
const { CrmError } = require('../../src/services/crm/zohoAuth');
const crmSettings = require('../../src/services/crm/crmSettings');

let prev;
beforeEach(() => {
  prev = { id: process.env.ZOHO_CLIENT_ID, secret: process.env.ZOHO_CLIENT_SECRET };
  process.env.ZOHO_CLIENT_ID = 'zoho-client';
  process.env.ZOHO_CLIENT_SECRET = 'zoho-secret';
});
afterEach(() => {
  for (const [k, v] of [['ZOHO_CLIENT_ID', prev.id], ['ZOHO_CLIENT_SECRET', prev.secret]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const REDIRECT = 'https://api.kgt.test/api/v1/public/crm/zoho/callback';

describe('crmSettings: getCrmStatus', () => {
  test('reports a connected integration with recent logs, never leaking tokens', async () => {
    const prisma = {
      tenantCRMIntegration: { findUnique: async () => ({ region: 'in', isEnabled: true, refreshToken: 'cipher', tokenExpiry: null, updatedAt: new Date() }) },
      cRMSyncLog: { findMany: async () => [{ id: 'l1', operation: 'lead.upsert', status: 'SUCCESS', direction: 'outbound', createdAt: new Date() }] }
    };
    const s = await crmSettings.getCrmStatus('t1', { prisma });
    assert.equal(s.connected, true);
    assert.equal(s.region, 'in');
    assert.equal(s.provider, 'ZOHO');
    assert.ok(s.regions.includes('in') && s.regions.includes('com'));
    assert.equal(s.recentLogs.length, 1);
    assert.ok(!('refreshToken' in s) && !('accessToken' in s), 'status never exposes tokens');
  });

  test('no integration reads as not connected', async () => {
    const prisma = { tenantCRMIntegration: { findUnique: async () => null }, cRMSyncLog: { findMany: async () => [] } };
    const s = await crmSettings.getCrmStatus('t1', { prisma });
    assert.equal(s.connected, false);
    assert.equal(s.isEnabled, false);
    assert.equal(s.region, 'in'); // selector defaults to India
  });
});

describe('crmSettings: beginConnect', () => {
  test('stores the region and returns a Zoho consent URL carrying a signed state', async () => {
    let upserted = null;
    const prisma = { tenantCRMIntegration: { upsert: async (args) => { upserted = args; return {}; } } };
    const { authUrl } = await crmSettings.beginConnect({ tenantId: 't1', region: 'in', redirectUri: REDIRECT }, { prisma });
    assert.match(authUrl, /^https:\/\/accounts\.zoho\.in\/oauth\/v2\/auth\?/);
    const u = new URL(authUrl);
    assert.equal(u.searchParams.get('client_id'), 'zoho-client');
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
    assert.ok(u.searchParams.get('state'), 'carries a state token');
    assert.equal(upserted.update.region, 'in');
  });

  test('rejects an unsupported region and an unconfigured server', async () => {
    const prisma = { tenantCRMIntegration: { upsert: async () => ({}) } };
    await assert.rejects(() => crmSettings.beginConnect({ tenantId: 't1', region: 'mars', redirectUri: REDIRECT }, { prisma }),
      (e) => e instanceof CrmError && e.statusCode === 400);
    delete process.env.ZOHO_CLIENT_SECRET;
    await assert.rejects(() => crmSettings.beginConnect({ tenantId: 't1', region: 'in', redirectUri: REDIRECT }, { prisma }),
      (e) => e instanceof CrmError && e.statusCode === 503);
  });
});

describe('crmSettings: server-managed connect (Self Client refresh token)', () => {
  let srvPrev;
  beforeEach(() => {
    srvPrev = { rt: process.env.ZOHO_REFRESH_TOKEN, api: process.env.ZOHO_API_DOMAIN };
    process.env.ZOHO_REFRESH_TOKEN = 'server-rt';
    process.env.ZOHO_API_DOMAIN = 'https://www.zohoapis.in';
  });
  afterEach(() => {
    for (const [k, v] of [['ZOHO_REFRESH_TOKEN', srvPrev.rt], ['ZOHO_API_DOMAIN', srvPrev.api]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  const fakePrisma = () => {
    const state = { upserted: null, deleted: false };
    return {
      state,
      tenantCRMIntegration: {
        upsert: async ({ update }) => { state.upserted = update; return { id: 'int-1', tenantId: 't1', ...update }; },
        update: async () => ({}),
        deleteMany: async () => { state.deleted = true; return { count: 1 }; }
      }
    };
  };

  test('getCrmStatus reports serverManaged with the server region', async () => {
    const prisma = { tenantCRMIntegration: { findUnique: async () => null }, cRMSyncLog: { findMany: async () => [] } };
    const s = await crmSettings.getCrmStatus('t1', { prisma });
    assert.equal(s.serverManaged, true);
    assert.equal(s.serverRegion, 'in');
    assert.equal(s.region, 'in');
  });

  test('beginConnect adopts the server token in place (no authUrl) and validates it', async () => {
    const prisma = fakePrisma();
    const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600, api_domain: 'https://www.zohoapis.in' }) });
    const r = await crmSettings.beginConnect({ tenantId: 't1' }, { prisma, fetchImpl });
    assert.deepEqual(r, { connected: true, region: 'in' });
    assert.ok(prisma.state.upserted.refreshToken && prisma.state.upserted.refreshToken !== 'server-rt', 'refresh token stored encrypted');
  });

  test('a refresh token that fails validation rolls back and errors', async () => {
    const prisma = fakePrisma();
    const fetchImpl = async () => ({ ok: false, status: 401 });
    await assert.rejects(() => crmSettings.beginConnect({ tenantId: 't1' }, { prisma, fetchImpl }), (e) => e instanceof CrmError);
    assert.equal(prisma.state.deleted, true, 'rolled back the stored connection');
  });
});

describe('crmSettings: completeConnect', () => {
  test('verifies state, exchanges the code and stores encrypted tokens', async () => {
    const state = signToken('crm_oauth', { tenantId: 't1', region: 'in' });
    let upserted = null;
    const prisma = { tenantCRMIntegration: { upsert: async (args) => { upserted = args; return {}; } } };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, api_domain: 'https://www.zohoapis.in' }) });
    const r = await crmSettings.completeConnect({ state, code: 'the-code', redirectUri: REDIRECT }, { prisma, fetchImpl });
    assert.deepEqual(r, { tenantId: 't1', region: 'in' });
    assert.notEqual(upserted.update.accessToken, 'at', 'access token stored as ciphertext');
    assert.notEqual(upserted.update.refreshToken, 'rt', 'refresh token stored as ciphertext');
    assert.ok(upserted.update.tokenExpiry instanceof Date);
  });

  test('a tampered/expired state is a 400 and nothing is stored', async () => {
    let touched = false;
    const prisma = { tenantCRMIntegration: { upsert: async () => { touched = true; return {}; } } };
    await assert.rejects(() => crmSettings.completeConnect({ state: 'not-a-token', code: 'c', redirectUri: REDIRECT }, { prisma }),
      (e) => e instanceof CrmError && e.statusCode === 400);
    assert.equal(touched, false);
  });

  test('a client token cannot stand in for the OAuth state', async () => {
    const clientToken = signToken('client', { tenantUserId: 'u1' });
    const prisma = { tenantCRMIntegration: { upsert: async () => ({}) } };
    await assert.rejects(() => crmSettings.completeConnect({ state: clientToken, code: 'c', redirectUri: REDIRECT }, { prisma }),
      (e) => e instanceof CrmError && e.statusCode === 400);
  });
});

describe('crmSettings: disconnect', () => {
  test('removes the integration', async () => {
    let where = null;
    const prisma = { tenantCRMIntegration: { deleteMany: async (args) => { where = args.where; return { count: 1 }; } } };
    const r = await crmSettings.disconnect('t1', { prisma });
    assert.deepEqual(r, { connected: false });
    assert.deepEqual(where, { tenantId: 't1' });
  });
});
