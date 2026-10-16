const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, loadStack, startServer, http, createTenant, signIn, dropTenants } = require('../support/realStack');

// Tenant isolation against a REAL database, through the real app: two
// companies, each signed in with its own client session and API key. Company
// A must not be able to read, change or delete anything of company B's — by
// listing, by guessing ids, through the widget, or through chat sessions —
// and staff must see both.

describe('tenant isolation (real PostgreSQL)', { skip: skipReason }, () => {
  let prisma, server, a, b, tokenA, tokenB, docB, leadB, sessionB;

  before(async () => {
    const stack = loadStack();
    prisma = stack.prisma;
    server = await startServer(stack.app);
    a = await createTenant(prisma, { name: 'Alpha', documents: [{ title: 'Alpha returns', content: '## Returns\n\nAlpha refunds within 30 days.' }] });
    b = await createTenant(prisma, { name: 'Bravo', documents: [{ title: 'Bravo secret pricing', content: '## Pricing\n\nBravo costs ₹4,321 per month.' }] });
    tokenA = await signIn(server.base, a);
    tokenB = await signIn(server.base, b);
    docB = await prisma.tenantDocument.findFirst({ where: { tenantId: b.tenant.id } });
    sessionB = await prisma.chatSession.create({
      data: { tenantId: b.tenant.id, botType: 'sales', messageCount: 2, lastMessageAt: new Date(), summary: 'Intent: Bravo secret plans' }
    });
    await prisma.chatMessage.create({ data: { sessionId: sessionB.id, role: 'user', content: 'Bravo private question', botType: 'sales' } });
    // A weak answer, so Bravo's session is an Improvements item (for Bravo only).
    await prisma.chatMessage.create({
      data: { sessionId: sessionB.id, role: 'assistant', content: 'Bravo weak answer', botType: 'sales', confidence: 0.1 }
    });
    leadB = await prisma.lead.create({ data: { tenantId: b.tenant.id, botType: 'sales', email: 'prospect@bravo.test', sessionId: sessionB.id } });
    await prisma.supportTicket.create({ data: { tenantId: b.tenant.id, query: 'Bravo ticket', transcript: [], botType: 'support' } });
  });

  after(async () => {
    await dropTenants(prisma, [a, b]);
    await server?.close();
    await prisma?.$disconnect();
  });

  const as = (token) => ({
    get: (path) => http(server.base, 'GET', `/api/v1/client/workspace${path}`, { token }),
    post: (path, body) => http(server.base, 'POST', `/api/v1/client/workspace${path}`, { token, body }),
    patch: (path, body) => http(server.base, 'PATCH', `/api/v1/client/workspace${path}`, { token, body }),
    del: (path) => http(server.base, 'DELETE', `/api/v1/client/workspace${path}`, { token })
  });

  test('listings only ever contain the signed-in company\'s rows', async () => {
    const docs = await as(tokenA).get('/documents');
    assert.equal(docs.status, 200);
    assert.deepEqual(docs.body.map((d) => d.title), ['Alpha returns']);

    const leads = await as(tokenA).get('/leads');
    assert.equal(leads.body.leads.length, 0);
    assert.equal(leads.body.counts.total, 0);

    const tickets = await as(tokenA).get('/tickets');
    assert.equal(tickets.body.length, 0);

    const split = await as(tokenA).get('/knowledge/distribution');
    assert.ok(!JSON.stringify(split.body).includes('Bravo'), 'no trace of the other company in the knowledge split');
  });

  test('another company\'s ids read as "not found" — and nothing of theirs changes', async () => {
    assert.equal((await as(tokenA).patch(`/documents/${docB.id}`, { title: 'hijacked' })).status, 404);
    assert.equal((await as(tokenA).del(`/documents/${docB.id}`)).status, 404);
    assert.equal((await as(tokenA).patch(`/leads/${leadB.id}`, { status: 'CONTACTED' })).status, 404);

    const docAfter = await prisma.tenantDocument.findUnique({ where: { id: docB.id } });
    assert.equal(docAfter.title, 'Bravo secret pricing');
    assert.equal((await prisma.lead.findUnique({ where: { id: leadB.id } })).status, 'NEW');
  });

  test('a client session cannot reach staff routes, and staff tokens are a different type', async () => {
    assert.equal((await http(server.base, 'GET', '/api/v1/tenants', { token: tokenA })).status, 401);
    assert.equal((await http(server.base, 'GET', `/api/v1/tenants/${b.tenant.id}/documents`, { token: tokenA })).status, 401);
  });

  test('the widget: one company\'s API key never works for another company', async () => {
    const r = await http(server.base, 'POST', `/api/v1/tenant-chat/${b.tenant.slug}/chat`, { apiKey: a.apiKey, body: { query: 'hello' } });
    assert.equal(r.status, 401);
  });

  test('another company\'s chat session id starts a fresh session instead of joining theirs', async () => {
    const r = await http(server.base, 'POST', `/api/v1/tenant-chat/${a.tenant.slug}/chat`, {
      apiKey: a.apiKey, body: { query: 'Hi there', botType: 'support', sessionId: sessionB.id }
    });
    assert.equal(r.status, 200);
    assert.notEqual(r.body.sessionId, sessionB.id);
    const created = await prisma.chatSession.findUnique({ where: { id: r.body.sessionId } });
    assert.equal(created.tenantId, a.tenant.id);
    assert.equal(await prisma.chatMessage.count({ where: { sessionId: sessionB.id } }), 2, 'nothing was added to the other company\'s chat');
  });

  test('session history, improvements and alert settings: never another company\'s, by listing or by id', async () => {
    const A = as(tokenA);
    const sessions = await A.get('/sessions');
    assert.equal(sessions.status, 200);
    assert.ok(!sessions.body.sessions.some((s) => s.id === sessionB.id));
    assert.ok(!JSON.stringify(sessions.body).includes('Bravo'));
    // A cursor naming the other company's session matches nothing of theirs either.
    const cursored = await A.get(`/sessions?cursor=${sessionB.id}`);
    assert.ok(!JSON.stringify(cursored.body).includes('Bravo'));

    const improvements = await A.get('/improvements');
    assert.equal(improvements.status, 200);
    assert.ok(!improvements.body.sessions.some((s) => s.id === sessionB.id));
    assert.ok(!JSON.stringify(improvements.body).includes('Bravo'));
    // Not vacuous: Bravo does see its own weak answer.
    const own = await as(tokenB).get('/improvements');
    assert.deepEqual(own.body.sessions.map((s) => s.id), [sessionB.id]);
    assert.equal(own.body.sessions[0].weak[0].question, 'Bravo private question');

    assert.equal((await A.get(`/sessions/${sessionB.id}`)).status, 404);
    assert.equal((await A.post(`/sessions/${sessionB.id}/summarize`)).status, 404);
    const after = await prisma.chatSession.findUnique({ where: { id: sessionB.id } });
    assert.equal(after.summaryStatus, 'none', 'no summary run was started on their session');
    assert.equal(after.summary, 'Intent: Bravo secret plans');

    assert.equal((await A.patch('/notifications', { teamEmail: 'alpha-team@example.test' })).status, 200);
    assert.equal((await prisma.tenant.findUnique({ where: { id: b.tenant.id } })).teamEmail, null, 'only the caller\'s own setting changes');
    const bravoSettings = await as(tokenB).get('/notifications');
    assert.ok(!JSON.stringify(bravoSettings.body).includes('alpha-team'));
  });

  test('the widget cannot end another company\'s conversation', async () => {
    const r = await http(server.base, 'POST', `/api/v1/tenant-chat/${a.tenant.slug}/session/end`, {
      apiKey: a.apiKey, body: { sessionId: sessionB.id }
    });
    assert.equal(r.status, 204, 'same answer as for any id, so ids cannot be probed');
    assert.equal((await prisma.chatSession.findUnique({ where: { id: sessionB.id } })).endedAt, null);
  });

  test('each company\'s bots only ever load their own knowledge', async () => {
    const { loadTenantKnowledge, invalidateTenantKnowledge } = require('../../src/domains/tenantProfile');
    invalidateTenantKnowledge(a.tenant.id);
    const chunks = await loadTenantKnowledge(a.tenant.id);
    assert.ok(chunks.length > 0);
    assert.ok(chunks.every((c) => !/Bravo|4,321/.test(c.content + c.title)));
  });

  test('staff see every company', async () => {
    const { hashPassword } = require('../../src/utils/password');
    const email = `staff-${Date.now()}@example.test`;
    const operator = await prisma.operator.create({ data: { email, name: 'Staff', passwordHash: hashPassword('staff-password-123') } });
    try {
      const login = await http(server.base, 'POST', '/api/v1/operator/login', { body: { email, password: 'staff-password-123' } });
      assert.equal(login.status, 200);
      const docs = await http(server.base, 'GET', `/api/v1/tenants/${b.tenant.id}/documents`, { token: login.body.token });
      assert.equal(docs.status, 200);
      assert.deepEqual(docs.body.map((d) => d.title), ['Bravo secret pricing']);
    } finally {
      await prisma.operator.delete({ where: { id: operator.id } });
    }
  });

  test('deleting a company removes everything it owns, and nothing of anyone else\'s', async () => {
    const c = await createTenant(prisma, { name: 'Charlie', documents: [{ title: 'Charlie doc', content: '## X\n\nY' }] });
    const session = await prisma.chatSession.create({ data: { tenantId: c.tenant.id } });
    await prisma.lead.create({ data: { tenantId: c.tenant.id, botType: 'support', email: 'x@charlie.test', sessionId: session.id } });
    await dropTenants(prisma, [c]);
    for (const model of ['tenantDocument', 'tenantUser', 'tenantApiKey', 'chatSession', 'lead']) {
      assert.equal(await prisma[model].count({ where: { tenantId: c.tenant.id } }), 0, model);
    }
    assert.equal(await prisma.tenantDocument.count({ where: { tenantId: b.tenant.id } }), 1, 'other companies untouched');
  });
});
