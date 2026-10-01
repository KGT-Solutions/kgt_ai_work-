const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

// The whole forgot-password lifecycle through the real routes and auth
// middleware, with Prisma replaced by an in-memory store (each call is
// atomic, like a single SQL statement) and the mailer captured.

const prisma = require('../src/lib/prisma');
const mailer = require('../src/services/mailer');
const sent = [];
mailer.sendMail = async (msg) => { sent.push(msg); return { sent: true, via: 'test' }; }; // before the router destructures it
const clientAuthRoutes = require('../src/routes/clientAuth.routes');
const { hashPassword, verifyPassword } = require('../src/utils/password');

const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'brand-new-password-456';
const TENANT = { id: 't1', slug: 'acme', name: 'Acme', industryLabel: 'SaaS', persona: null, active: true, outOfScopeMessage: 'x', minConfidence: 0.3, signupEmail: null, createdAt: new Date() };
let user;
let codes;

function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (v === null) return row[k] == null;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lt' in v) return row[k] < v.lt;
      if ('gt' in v) return row[k] > v.gt;
      return true;
    }
    return row[k] === v;
  });
}

// A few ms per query, like a real database round trip: without it each
// request finishes before the next starts and parallel requests never overlap.
// Each statement takes effect (or reads its snapshot) when issued, in order —
// only the reply is delayed — so a transaction's statements stay ordered.
const roundTrip = () => new Promise((r) => setTimeout(r, 5));
const reply = async (value) => { await roundTrip(); return value; };

before(() => {
  const findUser = async ({ where }) => {
    const hit = (where.email && where.email === user.email) || (where.id && where.id === user.id);
    return hit ? { ...user, tenant: TENANT } : null;
  };
  const updateUser = async ({ data }) => Object.assign(user, data);
  prisma.tenantUser.findUnique = findUser;
  prisma.tenantUser.update = updateUser;
  prisma.passwordResetCode.create = async ({ data }) => {
    const row = { id: `c${codes.length + 1}`, attempts: 0, usedAt: null, createdAt: new Date(), ...data };
    codes.push(row);
    return row;
  };
  prisma.passwordResetCode.findFirst = ({ where }) => {
    const row = [...codes].reverse().find((r) => matches(r, where));
    return reply(row ? { ...row } : null); // a snapshot, like a real query result
  };
  prisma.passwordResetCode.updateMany = ({ where, data }) => {
    let count = 0; // check-and-write in one step: atomic, as a single SQL UPDATE is
    for (const r of codes.filter((row) => matches(row, where))) {
      if (data.attempts?.increment) r.attempts += data.attempts.increment;
      if ('usedAt' in data) r.usedAt = data.usedAt;
      count += 1;
    }
    return reply({ count });
  };
  prisma.passwordResetCode.update = ({ where, data }) => {
    const r = codes.find((row) => row.id === where.id);
    if (data.attempts?.increment) r.attempts += data.attempts.increment;
    return reply({ ...r });
  };
  prisma.$transaction = async (arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
});

beforeEach(() => {
  // A fresh address per test: the per-email code limit (3 an hour) is in-memory and shared.
  user = { id: 'u1', email: `owner${ip + 1}@acme.test`, name: 'Owner', passwordHash: hashPassword(OLD_PASSWORD), passwordChangedAt: null, lastLoginAt: null };
  codes = [];
  sent.length = 0;
});

let server;
let base;
let ip = 0;
before(async () => {
  const app = express();
  app.set('trust proxy', true); // each test gets its own X-Forwarded-For, so the per-IP limiters don't interfere
  app.use(express.json());
  app.use('/api/v1/client', clientAuthRoutes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1/client`;
});
after(() => server.close());

let clientIp;
beforeEach(() => { ip += 1; clientIp = `198.51.100.${ip}`; });
const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const codeFromMail = () => sent.at(-1).subject.match(/^(\d{6})/)[1];
const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('forgot password → verify code → reset', () => {
  test('full lifecycle: the code works once, the new password is saved hashed, and older sessions are signed out', async () => {
    // A session from before the reset (e.g. an attacker's), issued a minute ago.
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const oldSession = jwt.sign({ tenantUserId: user.id, typ: 'client', iat: Math.floor(Date.now() / 1000) - 60 }, secret);

    const forgot = await post('/password/forgot', { email: ` ${user.email.toUpperCase()} ` });
    assert.equal(forgot.status, 200);
    assert.equal(sent.length, 1);
    const code = codeFromMail();
    assert.match(code, /^\d{6}$/);
    assert.ok(!codes[0].codeHash.includes(code), 'only a hash of the code is stored');
    assert.ok(codes[0].expiresAt - Date.now() <= 10 * 60 * 1000 && codes[0].expiresAt - Date.now() > 9 * 60 * 1000, 'expires in 10 minutes');

    const verify = await post('/password/verify', { email: user.email, code });
    assert.equal(verify.status, 200);
    const reset = await post('/password/reset', { resetToken: verify.body.resetToken, password: NEW_PASSWORD });
    assert.equal(reset.status, 200);

    assert.ok(verifyPassword(NEW_PASSWORD, user.passwordHash));
    assert.ok(!verifyPassword(OLD_PASSWORD, user.passwordHash));
    assert.ok(!user.passwordHash.includes(NEW_PASSWORD));

    const again = await post('/password/reset', { resetToken: verify.body.resetToken, password: 'yet-another-pass-789' });
    assert.equal(again.status, 400, 'a reset token is single-use');

    const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${oldSession}` } });
    assert.equal(me.status, 401, 'sessions from before the reset are rejected');
    assert.match((await me.json()).error, /password was changed/);

    const login = await post('/login', { email: user.email, password: NEW_PASSWORD });
    assert.equal(login.status, 200);
  });

  test('5 wrong codes lock that code: even the right one is refused afterwards', async () => {
    await post('/password/forgot', { email: user.email });
    const code = codeFromMail();
    for (let i = 1; i <= 5; i++) {
      const r = await post('/password/verify', { email: user.email, code: wrong(code) });
      assert.equal(r.status, 400);
      assert.match(r.body.error, i < 5 ? new RegExp(`${5 - i} attempts? left`) : /Too many wrong codes/);
    }
    const right = await post('/password/verify', { email: user.email, code });
    assert.equal(right.status, 429);
    assert.match(right.body.error, /Request a new code/);
  });

  test('guesses sent in parallel still get only 5 tries against one code', async () => {
    await post('/password/forgot', { email: user.email });
    const code = codeFromMail();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => post('/password/verify', { email: user.email, code: wrong(code) }))
    );
    const checked = results.filter((r) => r.status === 400).length;
    const refused = results.filter((r) => r.status === 429).length;
    assert.equal(checked, 5, `exactly 5 guesses may be compared, got ${checked}`);
    assert.equal(refused, 7);
    assert.equal(codes[0].attempts, 5);
  });

  test('an expired code is refused', async () => {
    await post('/password/forgot', { email: user.email });
    const code = codeFromMail();
    codes[0].expiresAt = new Date(Date.now() - 1000);
    const r = await post('/password/verify', { email: user.email, code });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /invalid or has expired/);
  });

  test('a new code voids the previous one', async () => {
    await post('/password/forgot', { email: user.email });
    const first = codeFromMail();
    await post('/password/forgot', { email: user.email });
    const second = codeFromMail();
    if (first !== second) {
      assert.equal((await post('/password/verify', { email: user.email, code: first })).status, 400);
    }
    assert.equal((await post('/password/verify', { email: user.email, code: second })).status, 200);
  });

  test('an unknown email gets the same reply as a real one, and no email is sent', async () => {
    const real = await post('/password/forgot', { email: user.email });
    const unknown = await post('/password/forgot', { email: 'nobody@nowhere.test' });
    assert.deepEqual(unknown, real);
    assert.equal(sent.length, 1);
  });

  test('a short new password is rejected', async () => {
    await post('/password/forgot', { email: user.email });
    const verify = await post('/password/verify', { email: user.email, code: codeFromMail() });
    const r = await post('/password/reset', { resetToken: verify.body.resetToken, password: 'short' });
    assert.equal(r.status, 400);
    assert.ok(verifyPassword(OLD_PASSWORD, user.passwordHash), 'nothing changed');
  });
});

describe('mailer', () => {
  test('EMAIL_FROM works as the sender when MAIL_FROM is not set', () => {
    const { mailFrom } = require('../src/services/mailer');
    const saved = { MAIL_FROM: process.env.MAIL_FROM, EMAIL_FROM: process.env.EMAIL_FROM };
    try {
      delete process.env.MAIL_FROM;
      process.env.EMAIL_FROM = 'KGT <noreply@kgt.test>';
      assert.equal(mailFrom(), 'KGT <noreply@kgt.test>');
      process.env.MAIL_FROM = 'Primary <a@kgt.test>';
      assert.equal(mailFrom(), 'Primary <a@kgt.test>', 'MAIL_FROM wins when both are set');
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
