process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-email';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'g-client';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'g-secret';
process.env.MICROSOFT_OAUTH_CLIENT_ID = 'm-client';
process.env.MICROSOFT_OAUTH_CLIENT_SECRET = 'm-secret';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const conn = require('../../src/services/emailConnection');
const { encrypt, isEncrypted } = require('../../src/utils/encryption');
const { verifyToken } = require('../../src/utils/authTokens');

// Feature 10 storage/orchestration: connect/disconnect, encrypted tokens that
// never leave the server, per-email toggles, and the mailer sender (with token
// refresh). Fake prisma + injected fetch; the real emailOAuth protocol runs.

const TENANT = { id: 't-email', name: 'Acme' };
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
const jwtWith = (c) => ['h', Buffer.from(JSON.stringify(c)).toString('base64url'), 's'].join('.');

function fakePrisma(seed = null) {
  let row = seed;
  return {
    getRow: () => row,
    setRow: (r) => { row = r; },
    tenantEmailSettings: {
      findUnique: async ({ where, select }) => {
        if (where.tenantId !== TENANT.id || !row) return null;
        if (select) return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
        return { ...row };
      },
      upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { id: 'e1', tenantId: TENANT.id, ...create }; return { ...row }; },
      update: async ({ data }) => { row = { ...row, ...data }; return { ...row }; }
    }
  };
}

describe('emailConnection: status & connect', () => {
  test('no row: not connected, providers configured, toggles default on', async () => {
    const s = await conn.getStatus(TENANT, { prisma: fakePrisma() });
    assert.equal(s.connected, false);
    assert.equal(s.providers.google.configured, true);
    assert.deepEqual(s.toggles, { leadAlerts: true, attentionAlerts: true, visitorConfirmation: true });
  });

  test('beginConnect returns a consent URL with a state bound to the tenant + provider', async () => {
    const { authUrl } = await conn.beginConnect({ tenantId: TENANT.id, provider: 'google', redirectUri: 'https://api.test/cb', actor: 'owner@acme.com' }, { prisma: fakePrisma() });
    const state = new URL(authUrl).searchParams.get('state');
    const claims = verifyToken(state, 'email_oauth');
    assert.equal(claims.tenantId, TENANT.id);
    assert.equal(claims.provider, 'google');
    assert.equal(claims.actor, 'owner@acme.com');
  });

  test('beginConnect for an unconfigured provider is a 503', async () => {
    const saved = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
    delete process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
    try {
      await assert.rejects(() => conn.beginConnect({ tenantId: TENANT.id, provider: 'microsoft', redirectUri: 'u' }, { prisma: fakePrisma() }),
        (e) => e instanceof conn.EmailConnectionError && e.statusCode === 503);
    } finally {
      process.env.MICROSOFT_OAUTH_CLIENT_SECRET = saved;
    }
  });

  test('completeConnect stores ENCRYPTED tokens + the mailbox, never plaintext', async () => {
    const prisma = fakePrisma();
    const { signToken } = require('../../src/utils/authTokens');
    const state = signToken('email_oauth', { tenantId: TENANT.id, provider: 'google', actor: 'owner@acme.com' });
    const fetchImpl = async () => resp({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'gmail.send', id_token: jwtWith({ email: 'owner@acme.com' }) });
    const out = await conn.completeConnect({ state, code: 'c', redirectUri: 'u' }, { prisma, fetchImpl });
    assert.equal(out.email, 'owner@acme.com');
    const row = prisma.getRow();
    assert.equal(row.provider, 'google');
    assert.equal(row.oauthEmail, 'owner@acme.com');
    assert.ok(isEncrypted(row.refreshToken) && row.refreshToken !== 'RT', 'refresh token is ciphertext');
    assert.ok(isEncrypted(row.accessToken) && row.accessToken !== 'AT', 'access token is ciphertext');
    const status = await conn.getStatus(TENANT, { prisma });
    assert.equal(status.connected, true);
  });

  test('disconnect clears the connection but keeps toggle preferences', async () => {
    const prisma = fakePrisma({ id: 'e1', tenantId: TENANT.id, provider: 'google', oauthEmail: 'o@a.com', refreshToken: encrypt('RT'), leadAlertsEnabled: false });
    const s = await conn.disconnect(TENANT, { prisma });
    assert.equal(s.connected, false);
    assert.equal(s.provider, null);
    assert.equal(s.toggles.leadAlerts, false, 'the toggle preference survives a disconnect');
  });
});

describe('emailConnection: per-email toggles', () => {
  test('setToggles persists and emailTypeEnabled reflects it (default on, explicit off)', async () => {
    const prisma = fakePrisma();
    assert.equal(await conn.emailTypeEnabled(TENANT.id, 'leadAlerts', { prisma }), true, 'default on with no row');
    const s = await conn.setToggles(TENANT, { leadAlerts: false }, { prisma });
    assert.equal(s.toggles.leadAlerts, false);
    assert.equal(s.toggles.attentionAlerts, true);
    assert.equal(await conn.emailTypeEnabled(TENANT.id, 'leadAlerts', { prisma }), false);
    assert.equal(await conn.emailTypeEnabled(TENANT.id, 'visitorConfirmation', { prisma }), true);
  });

  test('setToggles with no recognised keys is a 400', async () => {
    await assert.rejects(() => conn.setToggles(TENANT, { nope: true }, { prisma: fakePrisma() }),
      (e) => e instanceof conn.EmailConnectionError && e.statusCode === 400);
  });

  test('emailTypeEnabled fails OPEN on a lookup error (never silently drops mail)', async () => {
    const prisma = { tenantEmailSettings: { findUnique: async () => { throw new Error('db down'); } } };
    assert.equal(await conn.emailTypeEnabled(TENANT.id, 'leadAlerts', { prisma }), true);
  });
});

describe('emailConnection: resolveOAuthSender', () => {
  test('refreshes a stale token and sends via the provider; null when not connected', async () => {
    assert.equal(await conn.resolveOAuthSender(TENANT.id, { prisma: fakePrisma() }), null, 'no row → null');

    const prisma = fakePrisma({ id: 'e1', tenantId: TENANT.id, provider: 'google', oauthEmail: 'me@acme.com', refreshToken: encrypt('RT'), accessToken: null, tokenExpiry: null });
    const calls = [];
    const fetchImpl = async (url, opts) => {
      if (/oauth2\.googleapis\.com\/token/.test(url)) return resp({ access_token: 'fresh-AT', expires_in: 3600 });
      calls.push({ url, auth: opts.headers.authorization });
      return resp({ id: 'm1' });
    };
    const sender = await conn.resolveOAuthSender(TENANT.id, { prisma, fetchImpl, now: 0 });
    assert.equal(sender.provider, 'google');
    assert.equal(sender.from, 'me@acme.com');
    await sender.send({ to: 'x@y.com', subject: 's', text: 't' });
    assert.match(calls[0].url, /gmail\.googleapis\.com/);
    assert.equal(calls[0].auth, 'Bearer fresh-AT', 'used the freshly refreshed token');
    assert.ok(isEncrypted(prisma.getRow().accessToken), 'the refreshed token was persisted, encrypted');
  });
});
