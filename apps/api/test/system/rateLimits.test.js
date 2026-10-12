const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, loadStack, startServer, http, createTenant, dropTenants, uid } = require('../support/realStack');

// Abuse limits, end to end through the deployed app: each public endpoint
// that costs money or sends email stops a single client at its limit, while
// a different client is unaffected. No LLM key is set (support/realStack.js),
// so the audit uses its keyword estimate and nothing leaves the machine.

describe('system: rate limits', { skip: skipReason }, () => {
  let server, prisma, t;
  before(async () => {
    process.env.PREFLIGHT_AUDIT_RATE_LIMIT_MAX = ''; // the shipped default (12)
    process.env.SIGNUP_RATE_LIMIT_MAX = '';
    const stack = loadStack();
    prisma = stack.prisma;
    server = await startServer(stack.app);
    t = await createTenant(prisma, { name: 'Limits' });
  });
  after(async () => {
    await prisma?.emailVerification.deleteMany({ where: { email: { endsWith: '@limits.test' } } });
    await dropTenants(prisma, [t]);
    await server?.close();
    await prisma?.$disconnect();
  });

  // Sends `count` requests from one IP; returns their status codes.
  const burst = async (count, method, path, makeBody, ip) => {
    const statuses = [];
    for (let i = 0; i < count; i++) statuses.push((await http(server.base, method, path, { body: makeBody(i), ip })).status);
    return statuses;
  };

  test('signup code: 5 per 15 minutes per IP, then 429 — another visitor is unaffected', async () => {
    const statuses = await burst(6, 'POST', '/api/v1/public/auth/send-otp', () => ({ email: `${uid('v')}@limits.test` }), '198.18.0.10');
    assert.deepEqual(statuses.slice(0, 5).every((s) => s === 200), true, `first five: ${statuses.slice(0, 5)}`);
    assert.equal(statuses[5], 429);
    const other = await http(server.base, 'POST', '/api/v1/public/auth/send-otp', { body: { email: `${uid('w')}@limits.test` }, ip: '198.18.0.11' });
    assert.equal(other.status, 200);
  });

  test('pre-flight audit (an LLM call on a public route): 12 per 10 minutes per IP', async () => {
    const page = { title: 'About', content: '## Who we are\n\nWe sell thermostats with free returns.' };
    const statuses = await burst(13, 'POST', '/api/v1/public/register/preflight-audit', () => ({ pages: [page] }), '198.18.0.20');
    assert.ok(statuses.slice(0, 12).every((s) => s === 200), `first twelve: ${statuses.slice(0, 12)}`);
    assert.equal(statuses[12], 429);
  });

  test('client sign-in: 10 attempts per 15 minutes per IP', async () => {
    const statuses = await burst(11, 'POST', '/api/v1/client/login', () => ({ email: t.email, password: 'wrong-password-1' }), '198.18.0.30');
    assert.ok(statuses.slice(0, 10).every((s) => s === 401));
    assert.equal(statuses[10], 429);
  });

  test('widget chat: limited per company, whatever the visitor\'s IP', async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await http(server.base, 'POST', `/api/v1/tenant-chat/${t.tenant.slug}/chat`, { apiKey: t.apiKey, body: { query: 'hello' }, ip: `198.18.1.${i + 1}` })).status);
    }
    assert.ok(statuses.slice(0, 30).every((s) => s === 200), `first thirty: ${statuses.slice(0, 30)}`);
    assert.equal(statuses[30], 429);
  });
});
