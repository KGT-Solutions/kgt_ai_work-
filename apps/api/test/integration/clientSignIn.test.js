const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Sign-up -> sign-in round trip and the one-account-per-email rule, through
// the real routes: /register/complete writes the login, /client/login reads
// it back. Prisma is an in-memory store with TenantUser.email unique (like the
// database index); the email-OTP gate is satisfied with a real signed token.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-client-sign-in';
process.env.SIGNUP_RATE_LIMIT_MAX = '100';
const prisma = require('../../src/lib/prisma');
const { signToken } = require('../../src/utils/authTokens');
const { wrapRouterAsync } = require('../../src/utils/wrapAsync');
const { ACCOUNT_EXISTS } = require('../../src/services/verificationService');
const { verifyPassword } = require('../../src/utils/password');

let tenants, users, logs, server, base;
const STAFF = { email: 'admin@kgt.test', passwordHash: require('../../src/utils/password').hashPassword('staff-password-123') };
const unique = (err) => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/register', wrapRouterAsync(require('../../src/routes/publicRegister.routes')));
  app.use('/client', wrapRouterAsync(require('../../src/routes/clientAuth.routes')));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  tenants = [];
  users = [];
  logs = [];
  const tx = {
    emailVerification: { updateMany: async () => ({ count: 1 }) },
    tenant: {
      create: async ({ data }) => {
        if (data.signupEmail && tenants.some((t) => t.signupEmail === data.signupEmail)) throw unique();
        const t = { id: `t${tenants.length + 1}`, active: true, ...data };
        tenants.push(t);
        return t;
      }
    },
    tenantApiKey: { create: async ({ data }) => ({ id: 'k', ...data }) },
    tenantDocument: { createMany: async ({ data }) => ({ count: data.length }) },
    tenantConsent: { create: async () => ({}) },
    tenantUser: {
      create: async ({ data }) => {
        if (users.some((u) => u.email === data.email)) throw unique();
        const u = { id: `u${users.length + 1}`, passwordChangedAt: null, ...data };
        users.push(u);
        return u;
      }
    }
  };
  prisma.$transaction = async (fn) => fn(tx);
  prisma.tenantUser.findUnique = async ({ where, select }) => {
    const u = users.find((x) => (where.email ? x.email === where.email : x.id === where.id));
    if (!u) return null;
    return select?.tenant ? { ...u, tenant: tenants.find((t) => t.id === u.tenantId) } : u;
  };
  prisma.tenantUser.update = async ({ where, data }) => Object.assign(users.find((u) => u.id === where.id), data);
  prisma.tenantFaq.upsert = async () => ({});
  prisma.operator.findUnique = async ({ where }) => (where.email === STAFF.email ? STAFF : null);
  prisma.tenant.findUnique = async () => null; // background starter-FAQ / audit jobs find nothing to do
  for (const level of ['warn', 'log']) mock.method(console, level, (...a) => logs.push(a.join(' ')));
});

const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const signup = (email, password = 'a-long-password-1') => post('/register/complete', {
  companyName: 'Acme', email, password, industryLabel: 'Retail',
  pages: [{ title: 'About', content: 'We sell things.' }],
  emailVerificationToken: signToken('signup', { email: email.trim().toLowerCase(), verificationId: 'v1' })
});

describe('sign up, then sign in', () => {
  test('the account is stored lower-cased with a salted hash and linked to its company; sign-in reaches that company', async () => {
    const created = await signup('  Ana@Acme.TEST ', 'correct horse battery 42');
    assert.equal(created.status, 201);
    assert.equal(users.length, 1);
    assert.equal(users[0].email, 'ana@acme.test');
    assert.equal(users[0].tenantId, tenants[0].id);
    assert.match(users[0].passwordHash, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'scrypt salt:hash — never the password');
    assert.ok(verifyPassword('correct horse battery 42', users[0].passwordHash));

    for (const email of ['ana@acme.test', 'ANA@ACME.TEST', '  ana@acme.test  ']) {
      const login = await post('/client/login', { email, password: 'correct horse battery 42' });
      assert.equal(login.status, 200, email);
      assert.equal(login.body.tenant.slug, tenants[0].slug);
      assert.ok(login.body.token);
    }
  });

  test('a wrong password and an unknown email look the same to the visitor, but the log says which', async () => {
    await signup('ana@acme.test', 'correct horse battery 42');
    const wrong = await post('/client/login', { email: 'ana@acme.test', password: 'nope-nope-nope' });
    const unknown = await post('/client/login', { email: 'bob@acme.test', password: 'whatever-123' });
    assert.deepEqual([wrong.status, wrong.body.error], [401, 'Invalid email or password']);
    assert.deepEqual([unknown.status, unknown.body.error], [401, 'Invalid email or password']);
    assert.ok(logs.some((l) => /\[auth\] client sign-in refused for an\*\*\*@acme\.test: wrong password/.test(l)));
    assert.ok(logs.some((l) => /\[auth\] client sign-in refused for bo\*\*\*@acme\.test: no account with this email/.test(l)));
    assert.ok(!logs.some((l) => /nope-nope|whatever-123/.test(l)), 'passwords are never logged');
  });

  test('staff credentials on the company sign-in page are pointed to the staff console — but only with the right password', async () => {
    const right = await post('/client/login', { email: 'Admin@KGT.test', password: 'staff-password-123' });
    assert.equal(right.status, 401);
    assert.equal(right.body.code, 'STAFF_ACCOUNT');
    assert.equal(right.body.signInPath, '/admin/login');
    assert.ok(!right.body.token, 'never a client session for a staff account');
    const guess = await post('/client/login', { email: 'admin@kgt.test', password: 'a-wrong-guess-1' });
    assert.deepEqual([guess.status, guess.body], [401, { error: 'Invalid email or password' }], 'a wrong password reveals nothing');
  });

  test('a deactivated company cannot sign in', async () => {
    await signup('ana@acme.test');
    tenants[0].active = false;
    assert.equal((await post('/client/login', { email: 'ana@acme.test', password: 'a-long-password-1' })).status, 403);
  });
});

describe('one account per email address', () => {
  test('a second signup with the same address, in any case, is refused and creates nothing', async () => {
    await signup('ana@acme.test');
    const again = await signup('ANA@Acme.test ');
    assert.equal(again.status, 409);
    assert.equal(again.body.error, ACCOUNT_EXISTS);
    assert.equal(ACCOUNT_EXISTS, 'An account with this email address already exists. Please sign in instead.');
    assert.equal(tenants.length, 1);
    assert.equal(users.length, 1);
    assert.ok(logs.some((l) => /\[register\] signup refused \(409\) for an\*\*\*@acme\.test/.test(l)));
  });

  test('two signups racing on one address: the database\'s unique index wins and the loser gets the same message', async () => {
    const [a, b] = await Promise.all([signup('ana@acme.test'), signup('ana@acme.test')]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(users.length, 1);
  });

  test('every refusal is logged with its reason (a signup that never completes must not look like a login bug)', async () => {
    const res = await post('/register/complete', { companyName: 'Acme', email: 'cy@acme.test', password: 'a-long-password-1', industryLabel: 'Retail', pages: [{ title: 'A', content: 'B' }] });
    assert.equal(res.status, 403);
    assert.ok(logs.some((l) => /\[register\] signup refused \(403\) for cy\*\*\*@acme\.test: EMAIL_NOT_VERIFIED/.test(l)));
  });
});
