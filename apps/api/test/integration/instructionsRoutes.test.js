const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

// Feature 11 over HTTP: the dashboard's /instructions endpoints, scoped to
// req.tenant. TenantInstruction(+Version) are in-memory stand-ins. The actor on
// each saved version comes from req.tenantUser.email (set by the gatekeeper).

const TENANT = { id: 'tenant-instr', slug: 'acme', name: 'Acme', active: true };
let rows, versions, server, base;
let instrSeq, verSeq;

const realInstr = prisma.tenantInstruction;
const realVer = prisma.tenantInstructionVersion;

before(async () => {
  prisma.tenantInstruction = {
    findUnique: async ({ where }) => {
      const { tenantId, botType } = where.tenantId_botType;
      const r = rows.get(`${tenantId}:${botType}`);
      return r ? { ...r } : null;
    },
    update: async ({ where, data }) => {
      for (const r of rows.values()) if (r.id === where.id) { Object.assign(r, data, { updatedAt: new Date() }); return { ...r }; }
      throw new Error('not found');
    },
    create: async ({ data }) => {
      const row = { id: `i${++instrSeq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.set(`${data.tenantId}:${data.botType}`, row);
      return { ...row };
    }
  };
  prisma.tenantInstructionVersion = {
    create: async ({ data }) => { const v = { id: `v${++verSeq}`, createdAt: new Date(Date.now() + verSeq), ...data }; versions.push(v); return { ...v }; },
    findMany: async ({ where, take }) => versions
      .filter((v) => v.tenantId === where.tenantId && v.botType === where.botType)
      .sort((a, b) => b.version - a.version).slice(0, take || 50).map((v) => ({ ...v })),
    findFirst: async ({ where }) => {
      const v = versions.find((x) => x.id === where.id && x.tenantId === where.tenantId && x.botType === where.botType);
      return v ? { ...v } : null;
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/ws', (req, _res, next) => { req.tenant = TENANT; req.actor = 'client'; req.tenantUser = { email: 'owner@acme.test' }; next(); }, workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); prisma.tenantInstruction = realInstr; prisma.tenantInstructionVersion = realVer; });
beforeEach(() => { rows = new Map(); versions = []; instrSeq = 0; verSeq = 0; resetStore(); });

const call = (path, { method = 'GET', body } = {}) => fetch(`${base}${path}`, {
  method,
  headers: body !== undefined ? { 'content-type': 'application/json' } : {},
  body: body !== undefined ? JSON.stringify(body) : undefined
});

describe('GET /instructions', () => {
  test('returns defaults and the preset catalog for the UI', async () => {
    const res = await call('/ws/instructions?botType=support');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.version, 0);
    assert.equal(body.customized, false);
    assert.ok(body.presets.tone.friendly && body.presets.style.concise && body.presets.length.short, 'catalog present');
  });

  test('an unknown botType is a 400', async () => {
    assert.equal((await call('/ws/instructions?botType=marketing')).status, 400);
  });
});

describe('PUT /instructions', () => {
  test('saves, versions, and records the actor from the session', async () => {
    const res = await call('/ws/instructions', { method: 'PUT', body: { botType: 'sales', tone: 'playful', length: 'short', guidance: 'Be upbeat.', summary: 'launch voice' } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.version, 1);
    assert.equal(body.tone, 'playful');
    assert.equal(body.updatedBy, 'owner@acme.test');
    const vres = await (await call('/ws/instructions/versions?botType=sales')).json();
    assert.equal(vres.versions.length, 1);
    assert.equal(vres.versions[0].actor, 'owner@acme.test');
    assert.equal(vres.versions[0].summary, 'launch voice');
  });

  test('an invalid preset is a 400 and stores nothing', async () => {
    assert.equal((await call('/ws/instructions', { method: 'PUT', body: { botType: 'support', tone: 'grumpy' } })).status, 400);
    assert.equal((await (await call('/ws/instructions?botType=support')).json()).version, 0);
  });
});

describe('POST /instructions/restore', () => {
  test('restores a previous version as a new one', async () => {
    await call('/ws/instructions', { method: 'PUT', body: { botType: 'support', tone: 'friendly' } }); // v1
    await call('/ws/instructions', { method: 'PUT', body: { botType: 'support', tone: 'formal' } }); // v2
    const v1 = (await (await call('/ws/instructions/versions?botType=support')).json()).versions.find((v) => v.version === 1);
    const res = await call('/ws/instructions/restore', { method: 'POST', body: { botType: 'support', versionId: v1.id } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.version, 3);
    assert.equal(body.tone, 'friendly');
  });

  test('restore without a versionId is a 400', async () => {
    assert.equal((await call('/ws/instructions/restore', { method: 'POST', body: { botType: 'support' } })).status, 400);
  });
});
