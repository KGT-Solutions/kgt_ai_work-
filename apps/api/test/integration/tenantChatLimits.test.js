const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Small limits, set before the router reads them at import.
process.env.TENANT_CHAT_VISITOR_RATE_LIMIT_MAX = '3';
process.env.TENANT_TRANSCRIBE_RATE_LIMIT_MAX = '1';

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const tenantChatRouter = require('../../src/routes/tenantChat.routes');
const { hashApiKey } = require('../../src/utils/tenantApiKeys');

// Public chat + voice limits (adversarial review): a per-visitor limit beneath
// the per-tenant ones, and every voice refusal made BEFORE multer buffers the
// upload. Tenants and API keys are in-memory stand-ins.

const TENANTS = [
  { id: 't-a', slug: 'acme', name: 'Acme', active: true, key: `tk_${'a'.repeat(48)}` },
  { id: 't-b', slug: 'globex', name: 'Globex', active: true, key: `tk_${'b'.repeat(48)}` }
];
let server;
let base;
let prevGroq;

before(async () => {
  prevGroq = process.env.GROQ_API_KEY;
  prisma.tenant.findUnique = async ({ where }) => TENANTS.find((t) => t.slug === where.slug) || null;
  prisma.tenantApiKey.findUnique = async ({ where }) => {
    const t = TENANTS.find((x) => hashApiKey(x.key) === where.keyHash);
    return t ? { id: `k-${t.id}`, tenantId: t.id, revokedAt: null, lastUsedAt: new Date() } : null;
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tenant-chat', tenantChatRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: 'parse failure' })); // multer/busboy errors land here
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  if (prevGroq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = prevGroq;
});
beforeEach(() => {
  resetStore(); // fresh limit windows for every test
  process.env.GROQ_API_KEY = 'gsk_test'; // speech-to-text "configured"
});

const chat = (tenant) => fetch(`${base}/api/v1/tenant-chat/${tenant.slug}/chat`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-api-key': tenant.key }, body: '{}'
});
// A body multer cannot parse: if multer ran, this request would fail in the parser.
const malformedUpload = (tenant) => fetch(`${base}/api/v1/tenant-chat/${tenant.slug}/transcribe`, {
  method: 'POST',
  headers: { 'content-type': 'multipart/form-data; boundary=----kgt', 'x-tenant-api-key': tenant.key },
  body: 'this is not multipart at all'
});

describe('per-visitor limit on public chat', () => {
  test('a visitor is cut off after the limit; the same visitor on another tenant is not', async () => {
    const [acme, globex] = TENANTS;
    for (let i = 0; i < 3; i++) assert.equal((await chat(acme)).status, 400, 'reaches the handler (empty query)');
    const limited = await chat(acme);
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /very quickly/);
    assert.equal((await chat(globex)).status, 400, 'a separate tenant + IP bucket');
  });

  test('chat and voice share the visitor budget', async () => {
    const [acme] = TENANTS;
    for (let i = 0; i < 3; i++) await chat(acme);
    const res = await malformedUpload(acme);
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /very quickly/);
  });
});

describe('voice limits run before the upload is parsed', () => {
  test('with the tenant voice limit used up, even a malformed upload gets 429 — multer never ran', async () => {
    const [acme] = TENANTS;
    const first = await malformedUpload(acme);
    assert.notEqual(first.status, 429, 'under the limit, the request reaches the parser');
    const second = await malformedUpload(acme);
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /voice messages/);
  });

  test('with speech-to-text unconfigured, it refuses (503) before reading the upload', async () => {
    delete process.env.GROQ_API_KEY;
    const res = await malformedUpload(TENANTS[0]);
    assert.equal(res.status, 503);
  });
});
