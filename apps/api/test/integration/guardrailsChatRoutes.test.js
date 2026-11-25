const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// The per-device rate limit and country blocking as the widget actually hits
// them, on the public chat router. The chat handler and the theme lookup are
// stubbed (replaced on their modules BEFORE the router is required, since the
// router destructures them at load) so these tests isolate the guardrail
// middleware itself — not the engine.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const tenantChatSvc = require('../../src/services/tenantChat');
const branding = require('../../src/services/branding');
tenantChatSvc.handleChat = (req, res) => res.json({ answer: 'handler', sessionId: 's-handler' });
branding.publicTheme = async () => ({ theme: null, companyName: 'Acme' });

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const { hashApiKey } = require('../../src/utils/tenantApiKeys');
const { defaults } = require('../../src/services/guardrails');
const router = require('../../src/routes/tenantChat.routes');

const KEY = `tk_${'a'.repeat(48)}`;
const TENANT = { id: 't1', slug: 'acme', active: true };
let guardrails; // per-test config returned by prisma.tenantGuardrails.findUnique
let server, base;

before(async () => {
  prisma.tenant.findUnique = async ({ where }) => (where.slug === TENANT.slug ? TENANT : null);
  prisma.tenantApiKey.findUnique = async ({ where }) =>
    (hashApiKey(KEY) === where.keyHash ? { id: 'k1', tenantId: TENANT.id, revokedAt: null, lastUsedAt: new Date(), allowedOrigins: [] } : null);
  prisma.tenantApiKey.update = async () => ({});
  prisma.tenantGuardrails = { findUnique: async ({ select }) => {
    if (!guardrails) return null;
    return Object.fromEntries(Object.keys(select).map((k) => [k, guardrails[k]]));
  } };

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/v1/tenant-chat', router);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { resetStore(); guardrails = { ...defaults() }; });

const chat = (body, headers = {}) => fetch(`${base}/api/v1/tenant-chat/acme/chat`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-api-key': KEY, ...headers }, body: JSON.stringify(body)
});
const theme = (headers = {}) => fetch(`${base}/api/v1/tenant-chat/acme/theme`, { headers: { 'x-tenant-api-key': KEY, ...headers } });
const json = async (res) => ({ status: res.status, body: await res.json() });

describe('per-device rate limit', () => {
  test('a device over its limit gets 200 + limitMessage, not an error, and the handler is skipped', async () => {
    guardrails = { ...defaults(), maxMessages: 2, windowSeconds: 60, limitMessage: 'Slow down please.' };
    const b1 = await json(await chat({ query: 'hi', browserId: 'dev-A' }));
    const b2 = await json(await chat({ query: 'hi', browserId: 'dev-A' }));
    const b3 = await json(await chat({ query: 'hi', browserId: 'dev-A' }));
    assert.equal(b1.body.answer, 'handler');
    assert.equal(b2.body.answer, 'handler');
    assert.equal(b3.status, 200);
    assert.equal(b3.body.rateLimited, true);
    assert.equal(b3.body.answer, 'Slow down please.');
    assert.equal(b3.body.answer === 'handler', false, 'the handler must not run for a limited device');
  });

  test('the limited response echoes the incoming sessionId so the conversation continues', async () => {
    guardrails = { ...defaults(), maxMessages: 1, windowSeconds: 60 };
    await chat({ query: 'hi', browserId: 'dev-S', sessionId: 'sess-xyz' });
    const limited = await json(await chat({ query: 'hi', browserId: 'dev-S', sessionId: 'sess-xyz' }));
    assert.equal(limited.body.rateLimited, true);
    assert.equal(limited.body.sessionId, 'sess-xyz');
  });

  test('a different browserId, and a WhatsApp phone, are counted separately', async () => {
    guardrails = { ...defaults(), maxMessages: 1, windowSeconds: 60 };
    assert.equal((await json(await chat({ query: 'hi', browserId: 'A' }))).body.answer, 'handler');
    assert.equal((await json(await chat({ query: 'hi', browserId: 'B' }))).body.answer, 'handler', 'a different device is unaffected');
    assert.equal((await json(await chat({ query: 'hi', phone: '+15550000' }))).body.answer, 'handler', 'a phone is a different device');
    assert.equal((await json(await chat({ query: 'hi', browserId: 'A' }))).body.rateLimited, true);
  });

  test('a tenant with no configured limit never rate-limits per device', async () => {
    guardrails = { ...defaults() }; // maxMessages/windowSeconds null
    for (let i = 0; i < 6; i++) assert.equal((await json(await chat({ query: 'hi', browserId: 'D' }))).body.answer, 'handler');
  });
});

describe('country blocking', () => {
  test('a blocked country gets 403 on BOTH the chat and the theme route (so the widget cannot mount)', async () => {
    guardrails = { ...defaults(), blockedCountries: ['RU'] };
    const c = await json(await chat({ query: 'hi' }, { 'cf-ipcountry': 'RU' }));
    assert.equal(c.status, 403);
    assert.equal(c.body.blocked, 'country');
    const t = await theme({ 'cf-ipcountry': 'RU' });
    assert.equal(t.status, 403);
    assert.equal((await t.json()).blocked, 'country');
  });

  test('the Vercel edge header is honoured too', async () => {
    guardrails = { ...defaults(), blockedCountries: ['CN'] };
    assert.equal((await chat({ query: 'hi' }, { 'x-vercel-ip-country': 'CN' })).status, 403);
  });

  test('fails open when the header is absent, unknown (XX) or Tor (T1): the request is served', async () => {
    guardrails = { ...defaults(), blockedCountries: ['RU'] };
    assert.equal((await json(await chat({ query: 'hi' }))).body.answer, 'handler'); // no header
    assert.equal((await json(await chat({ query: 'hi' }, { 'cf-ipcountry': 'XX' }))).body.answer, 'handler');
    assert.equal((await json(await chat({ query: 'hi' }, { 'cf-ipcountry': 'T1' }))).body.answer, 'handler');
  });

  test('an un-blocked country is served normally', async () => {
    guardrails = { ...defaults(), blockedCountries: ['RU'] };
    assert.equal((await json(await chat({ query: 'hi' }, { 'cf-ipcountry': 'US' }))).body.answer, 'handler');
  });
});

describe('theme carries the image toggle', () => {
  test('imagesEnabled is reported so the widget can hide its attach button', async () => {
    guardrails = { ...defaults(), imagesEnabled: false };
    assert.equal((await (await theme()).json()).imagesEnabled, false);
    guardrails = { ...defaults(), imagesEnabled: true };
    assert.equal((await (await theme()).json()).imagesEnabled, true);
  });
});
