const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

// The forgot-password flow through the real routes and auth middleware:
//   POST /api/v1/public/auth/forgot-password  { email }
//   POST /api/v1/public/auth/reset-password   { email, otp, newPassword }
// then sign-in and an old session at /api/v1/client. Prisma is an in-memory
// store (each call is atomic, like a single SQL statement) and the mailer is captured.

const prisma = require('../../src/lib/prisma');
const mailer = require('../../src/services/mailer');
const sent = [];
mailer.sendMail = async (msg) => { sent.push(msg); return { sent: true, via: 'test' }; };
const clientAuthRoutes = require('../../src/routes/clientAuth.routes');
const publicAuthRoutes = require('../../src/routes/publicAuth.routes');
const { wrapRouterAsync } = require('../../src/utils/wrapAsync');
const { hashPassword, verifyPassword } = require('../../src/utils/password');
const { NO_ACCOUNT } = require('../../src/services/passwordResetService');

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
  prisma.tenantUser.findUnique = async ({ where }) => {
    const hit = (where.email && where.email === user.email) || (where.id && where.id === user.id);
    return hit ? { ...user, tenant: TENANT } : null;
  };
  prisma.tenantUser.update = async ({ data }) => Object.assign(user, data);
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
  prisma.$transaction = async (arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg));
});

let ip = 0;
let clientIp;
beforeEach(() => {
  ip += 1;
  clientIp = `198.51.100.${ip}`;
  // A fresh address per test: the per-email code limit (3 an hour) is in-memory and shared.
  user = { id: 'u1', email: `owner${ip}@acme.test`, name: 'Owner', passwordHash: hashPassword(OLD_PASSWORD), passwordChangedAt: null, lastLoginAt: null };
  codes = [];
  sent.length = 0;
});

let server;
let base;
before(async () => {
  const app = express();
  app.set('trust proxy', true); // each test gets its own X-Forwarded-For, so the per-IP limiters don't interfere
  app.use(express.json());
  app.use('/api/v1/client', wrapRouterAsync(clientAuthRoutes));
  app.use('/api/v1/public/auth', wrapRouterAsync(publicAuthRoutes));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
after(() => server.close());

const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const forgot = (email = user.email) => post('/public/auth/forgot-password', { email });
const reset = (otp, newPassword = NEW_PASSWORD, email = user.email) => post('/public/auth/reset-password', { email, otp, newPassword });
const codeFromMail = () => sent.at(-1).subject.match(/^(\d{6})/)[1];
const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('forgot password -> reset with the code', () => {
  test('full lifecycle: the code works once, the new password is saved hashed, and older sessions are signed out', async () => {
    // A session from before the reset (e.g. an attacker's), issued a minute ago.
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const oldSession = jwt.sign({ tenantUserId: user.id, typ: 'client', iat: Math.floor(Date.now() / 1000) - 60 }, secret);

    const requested = await forgot(` ${user.email.toUpperCase()} `);
    assert.equal(requested.status, 200);
    assert.deepEqual(requested.body, { ok: true, email: user.email, expiresInSeconds: 600, resendInSeconds: 60 });
    assert.equal(sent.length, 1);
    const code = codeFromMail();
    assert.match(code, /^\d{6}$/);
    assert.match(sent[0].html, /Valid for 10 minutes/);
    assert.ok(!codes[0].codeHash.includes(code), 'only a hash of the code is stored');
    assert.ok(codes[0].expiresAt - Date.now() <= 10 * 60 * 1000 && codes[0].expiresAt - Date.now() > 9 * 60 * 1000, 'expires in 10 minutes');

    const done = await reset(code);
    assert.deepEqual([done.status, done.body], [200, { ok: true }]);
    assert.ok(verifyPassword(NEW_PASSWORD, user.passwordHash));
    assert.ok(!verifyPassword(OLD_PASSWORD, user.passwordHash));
    assert.ok(!user.passwordHash.includes(NEW_PASSWORD));

    const again = await reset(code, 'yet-another-pass-789');
    assert.equal(again.status, 400, 'a code is single-use');

    const me = await fetch(`${base}/client/me`, { headers: { authorization: `Bearer ${oldSession}` } });
    assert.equal(me.status, 401, 'sessions from before the reset are rejected');
    assert.match((await me.json()).error, /password was changed/);

    assert.equal((await post('/client/login', { email: user.email, password: NEW_PASSWORD })).status, 200);
    assert.equal((await post('/client/login', { email: user.email, password: OLD_PASSWORD })).status, 401);
  });

  test('an email with no account is told so immediately, and nothing is sent', async () => {
    const r = await forgot('nobody@nowhere.test');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, NO_ACCOUNT);
    assert.equal(r.body.code, 'EMAIL_NOT_FOUND');
    assert.equal(sent.length, 0);
  });

  test('5 wrong codes lock that code: even the right one is refused afterwards', async () => {
    await forgot();
    const code = codeFromMail();
    for (let i = 1; i <= 5; i++) {
      const r = await reset(wrong(code));
      assert.equal(r.status, i < 5 ? 400 : 429);
      assert.match(r.body.error, i < 5 ? new RegExp(`${5 - i} attempts? left`) : /Too many wrong codes/);
    }
    const right = await reset(code);
    assert.equal(right.status, 429);
    assert.match(right.body.error, /Request a new code/);
    assert.ok(verifyPassword(OLD_PASSWORD, user.passwordHash), 'nothing changed');
  });

  test('guesses sent in parallel still get only 5 tries against one code', async () => {
    await forgot();
    const code = codeFromMail();
    const results = await Promise.all(Array.from({ length: 12 }, () => reset(wrong(code))));
    // A guess that was actually compared reports attemptsLeft; one refused before comparing doesn't.
    const compared = results.filter((r) => 'attemptsLeft' in r.body).length;
    assert.equal(codes[0].attempts, 5);
    assert.equal(compared, 5, `exactly 5 guesses may be compared, got ${compared}`);
    assert.equal(results.length - compared, 7);
  });

  test('an expired code is refused', async () => {
    await forgot();
    codes[0].expiresAt = new Date(Date.now() - 1000);
    const r = await reset(codeFromMail());
    assert.equal(r.status, 400);
    assert.match(r.body.error, /invalid or has expired/);
  });

  test('a second code within 60s is refused; after that, a new code voids the previous one', async () => {
    await forgot();
    const first = codeFromMail();
    const tooSoon = await forgot();
    assert.equal(tooSoon.status, 429);
    assert.ok(tooSoon.body.retryAfter > 55);

    codes[0].createdAt = new Date(Date.now() - 61 * 1000);
    assert.equal((await forgot()).status, 200);
    const second = codeFromMail();
    if (first !== second) assert.equal((await reset(first)).status, 400);
    assert.equal((await reset(second)).status, 200);
  });

  test('a short new password is rejected without using up an attempt', async () => {
    await forgot();
    const r = await reset(codeFromMail(), 'short');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /at least 10 characters/);
    assert.equal(codes[0].attempts, 0);
    assert.ok(verifyPassword(OLD_PASSWORD, user.passwordHash), 'nothing changed');
  });

  test('if the email can\'t be sent: 502, the code is voided, and an immediate retry is allowed', async () => {
    const original = mailer.sendMail;
    mailer.sendMail = async () => ({ sent: false, via: 'smtp', reason: 'auth' });
    try {
      const r = await forgot();
      assert.equal(r.status, 502);
      assert.ok(codes[0].usedAt, 'the undelivered code can never be used');
    } finally {
      mailer.sendMail = original;
    }
    assert.equal((await forgot()).status, 200);
  });

  test('a deactivated company cannot reset', async () => {
    TENANT.active = false;
    try {
      assert.equal((await forgot()).status, 403);
    } finally {
      TENANT.active = true;
    }
  });
});

describe('mailer', () => {
  test('EMAIL_FROM works as the sender when MAIL_FROM is not set', () => {
    const { mailFrom } = require('../../src/services/mailer');
    const saved = { MAIL_FROM: process.env.MAIL_FROM, EMAIL_FROM: process.env.EMAIL_FROM, SMTP_FROM: process.env.SMTP_FROM };
    try {
      delete process.env.MAIL_FROM;
      delete process.env.SMTP_FROM;
      process.env.EMAIL_FROM = 'KGT <noreply@kgt.test>';
      assert.equal(mailFrom(), 'KGT <noreply@kgt.test>');
      process.env.MAIL_FROM = 'Primary <a@kgt.test>';
      assert.equal(mailFrom(), 'Primary <a@kgt.test>', 'MAIL_FROM wins when both are set');
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
