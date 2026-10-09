const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// The readiness audit over HTTP: the signup wizard's public
// /preflight-audit -> /complete hand-off, and the workspace endpoints
// (/preflight-audit, /readiness, /knowledge/distribution, botScope on
// documents). Prisma is an in-memory store; the LLM is a mock.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-readiness-routes';
// Belt and braces: no provider key, so even a missed mock can never reach a
// real LLM (dotenv never overrides a variable that's already set).
for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = '';
const llmClient = require('../src/engine/llmClient');
mock.method(llmClient, 'isLlmConfigured', () => true);
const PILLAR_IDS = ['identity', 'features', 'pricing', 'support', 'sales'];
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async () => ({
  text: JSON.stringify({
    pillars: Object.fromEntries(PILLAR_IDS.map((id) => [id, { score: 90, summary: 'ok', gaps: [] }])),
    criticalGaps: ['No support hours'], recommendations: ['Add support hours']
  }),
  provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 }
}));

const prisma = require('../src/lib/prisma');
const { wrapRouterAsync } = require('../src/utils/wrapAsync');
const publicRegister = wrapRouterAsync(require('../src/routes/publicRegister.routes'));
const workspace = require('../src/routes/tenantWorkspace.routes');
const { contentHash } = require('../src/services/botAuditor');
const { signToken } = require('../src/utils/authTokens');

const long = (s, n) => Array.from({ length: n }, (_, i) => `${s} ${i}.`).join(' ');
const PAGES = [
  { title: 'About Acme', content: `## Who we are\n\n${long('Acme builds smart thermostats', 80)}`, category: 'CORE_OVERVIEW' },
  { title: 'Pricing', content: `## Plans\n\n${long('Pro costs ₹999 per month', 80)}`, category: 'CUSTOM_POLICY', botScope: 'sales' },
  { title: 'Help', content: `## Not working\n\n${long('Reset the device if it is not working', 80)}`, category: 'FAQ' }
];

let tenants, docs, server, base;
const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
// Model calls made by the auditor (signup also starts starter-FAQ generation, a different call).
const auditCalls = () => generateAnswerMock.mock.calls.filter((c) => /You audit the knowledge base/.test(c.arguments[0].systemPrompt)).length;

before(async () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/register', publicRegister);
  app.use('/ws', (req, _res, next) => { req.tenant = tenants[0]; req.actor = 'client'; next(); }, workspace);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  tenants = [];
  docs = [];
  generateAnswerMock.mock.resetCalls();
  const byId = (id) => tenants.find((t) => t.id === id);
  const tx = {
    tenant: { create: async ({ data }) => { const t = { id: `t${tenants.length + 1}`, ...data }; tenants.push(t); return t; } },
    tenantApiKey: { create: async ({ data }) => ({ id: 'k1', ...data }) },
    tenantDocument: { createMany: async ({ data }) => { docs.push(...data.map((d, i) => ({ id: `d${docs.length + i + 1}`, ...d }))); return { count: data.length }; } },
    tenantConsent: { create: async () => ({}) },
    tenantUser: { create: async ({ data }) => ({ id: 'u1', passwordChangedAt: null, ...data }) },
    // The email-OTP gate (services/verificationService.js claimVerification): a verified, unused row.
    emailVerification: { updateMany: async ({ where }) => ({ count: where.id === 'v1' ? 1 : 0 }) }
  };
  prisma.$transaction = async (fn) => fn(tx);
  prisma.tenantUser.findUnique = async () => null;
  prisma.tenant.findUnique = async ({ where }) => byId(where.id) || null;
  prisma.tenant.update = async ({ where, data }) => Object.assign(byId(where.id), data);
  prisma.tenantDocument.findMany = async ({ where }) => docs.filter((d) => d.tenantId === where.tenantId);
  prisma.tenantDocument.count = async ({ where }) => docs.filter((d) => d.tenantId === where.tenantId).length;
  prisma.tenantDocument.findFirst = async ({ where }) => docs.find((d) => d.id === where.id && d.tenantId === where.tenantId) || null;
  prisma.tenantDocument.update = async ({ where, data }) => Object.assign(docs.find((d) => d.id === where.id), data);
  prisma.tenantFaq.upsert = async () => ({});
  prisma.usageLog.create = async () => null;
});

describe('signup wizard: /preflight-audit then /complete', () => {
  const signup = (pages, email = `ana${Math.random()}@acme.test`) => post('/register/complete', {
    companyName: 'Acme', email, password: 'a-long-password', industryLabel: 'Smart home', pages,
    emailVerificationToken: signToken('signup', { email, verificationId: 'v1' })
  });

  test('the wizard audit returns the full report without creating anything', async () => {
    const { status, body } = await json(await post('/register/preflight-audit', { companyName: 'Acme', industryLabel: 'Smart home', pages: PAGES }));
    assert.equal(status, 200);
    assert.equal(body.readinessScore, 90);
    assert.equal(body.readinessLevel, 'Production Ready');
    assert.equal(body.pillarScores.length, 5);
    assert.deepEqual(body.criticalGaps, ['No support hours']);
    assert.ok(body.distribution.supportBot > 0 && body.distribution.salesBot > 0);
    assert.equal(tenants.length, 0);
  });

  test('/complete keeps the report the visitor reviewed — no second audit — and saves each page\'s botScope', async () => {
    const audit = await json(await post('/register/preflight-audit', { companyName: 'Acme', industryLabel: 'Smart home', pages: PAGES }));
    const { status, body } = await json(await signup(PAGES));
    assert.equal(status, 201);
    assert.deepEqual(body.readiness, { score: 90, level: 'Production Ready' });
    assert.equal(auditCalls(), 1, 'audited once, in the wizard');
    assert.equal(tenants[0].readinessScore, 90);
    assert.equal(tenants[0].readinessContentHash, audit.body.contentHash);
    assert.deepEqual(docs.map((d) => d.botScope), ['AUTO', 'SALES', 'AUTO']);
  });

  test('pages edited after the audit get a fresh audit in the background instead', async () => {
    await post('/register/preflight-audit', { companyName: 'Acme', industryLabel: 'Smart home', pages: PAGES });
    const edited = [...PAGES.slice(0, 2), { ...PAGES[2], content: `${PAGES[2].content} Call us on weekdays.` }];
    const { body } = await json(await signup(edited));
    assert.equal(body.readiness, null);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(auditCalls(), 2);
    assert.equal(tenants[0].readinessContentHash, contentHash(docs));
  });

  test('bad input is rejected before any model call', async () => {
    assert.equal((await post('/register/preflight-audit', { pages: [] })).status, 400);
    assert.equal((await post('/register/preflight-audit', { pages: [{ ...PAGES[0], botScope: 'marketing' }] })).status, 400);
    assert.equal(generateAnswerMock.mock.callCount(), 0);
  });
});

describe('workspace: readiness and the knowledge split', () => {
  beforeEach(() => {
    tenants.push({ id: 't1', name: 'Acme', industryLabel: 'Smart home' });
    docs.push(...PAGES.map((p, i) => ({ id: `d${i + 1}`, tenantId: 't1', botScope: 'AUTO', ...p, botScope: (p.botScope || 'AUTO').toUpperCase() })));
  });

  test('POST /preflight-audit saves the report; GET /readiness reports it, then marks it stale after an edit', async () => {
    const audit = await json(await post('/ws/preflight-audit', {}));
    assert.equal(audit.status, 200);
    assert.equal(tenants[0].readinessScore, 90);
    let readiness = await json(await fetch(`${base}/ws/readiness`));
    assert.equal(readiness.body.report.readinessScore, 90);
    assert.equal(readiness.body.stale, false);

    const patched = await fetch(`${base}/ws/documents/d3`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botScope: 'both' })
    });
    assert.equal(patched.status, 200);
    assert.equal(docs[2].botScope, 'BOTH');
    readiness = await json(await fetch(`${base}/ws/readiness`));
    assert.equal(readiness.body.stale, true);
  });

  test('GET /knowledge/distribution shows how each document splits between the bots', async () => {
    const { body } = await json(await fetch(`${base}/ws/knowledge/distribution`));
    const byTitle = Object.fromEntries(body.documents.map((d) => [d.title, d]));
    assert.deepEqual(byTitle.Pricing.sections, [{ title: 'Plans', scope: 'sales' }]);
    assert.deepEqual(byTitle.Help.sections, [{ title: 'Not working', scope: 'support' }]);
    assert.equal(byTitle['About Acme'].sections[0].scope, 'both');
    assert.deepEqual(body.totals, { support: 1, sales: 1, both: 1, supportBot: 2, salesBot: 2, total: 3 });
  });

  test('an invalid botScope is rejected', async () => {
    const res = await fetch(`${base}/ws/documents/d1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botScope: 'everyone' })
    });
    assert.equal(res.status, 400);
  });
});
