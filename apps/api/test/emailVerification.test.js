const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Signup email verification: services/verificationService.js and
// routes/publicAuth.routes.js, plus the 403 gate on /register/complete.
// Prisma is an in-memory store that applies conditional updates the way
// Postgres would; the mailer is captured.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-email-verification';
const mailer = require('../src/services/mailer');
let mailResult = { sent: true, via: 'smtp' };
const sendMailMock = mock.method(mailer, 'sendMail', async () => mailResult);

const prisma = require('../src/lib/prisma');
const { signToken } = require('../src/utils/authTokens');
const {
  sendSignupOtp, verifySignupOtp, claimVerification, VerificationError, MAX_ATTEMPTS
} = require('../src/services/verificationService');
const { wrapRouterAsync } = require('../src/utils/wrapAsync');

let rows, users;
// where: plain values, null, { lt }, { gt }; data: plain values or { increment }.
const matches = (row, where) => Object.entries(where).every(([k, v]) => {
  if (v === null) return row[k] == null;
  if (v instanceof Date) return +row[k] === +v;
  if (v && typeof v === 'object' && 'lt' in v) return row[k] < v.lt;
  if (v && typeof v === 'object' && 'gt' in v) return row[k] != null && row[k] > v.gt;
  return row[k] === v;
});
const apply = (row, data) => {
  for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
  return row;
};
const ev = {
  // A snapshot, like a real query: later updates don't change what was read.
  findUnique: async ({ where }) => { const r = rows.find((x) => x.email === where.email); return r ? { ...r } : null; },
  upsert: async ({ where, create, update }) => {
    const row = rows.find((r) => r.email === where.email);
    if (row) return apply(row, update);
    const created = { id: `v${rows.length + 1}`, attempts: 0, verified: false, verifiedAt: null, usedAt: null, ...create };
    rows.push(created);
    return created;
  },
  update: async ({ where, data }) => apply(rows.find((r) => (where.id ? r.id === where.id : r.email === where.email)), data),
  updateMany: async ({ where, data }) => {
    const hit = rows.filter((r) => matches(r, where));
    hit.forEach((r) => apply(r, data));
    return { count: hit.length };
  }
};

beforeEach(() => {
  rows = [];
  users = [];
  mailResult = { sent: true, via: 'smtp' };
  sendMailMock.mock.resetCalls();
  prisma.emailVerification = ev;
  prisma.tenantUser.findUnique = async ({ where }) => users.find((u) => u.email === where.email) || null;
});

const codeFromMail = () => /is (\d{6})/.exec(sendMailMock.mock.calls.at(-1).arguments[0].text)[1];
const rejects = (promise, status, pattern) => assert.rejects(promise, (e) => e instanceof VerificationError && e.statusCode === status && pattern.test(e.message));

describe('sending a code', () => {
  test('emails a 6-digit code from our sender; stores only its hash, with a 10-minute expiry', async () => {
    const r = await sendSignupOtp('  Ana@Acme.TEST ');
    assert.deepEqual(r, { ok: true, email: 'ana@acme.test', expiresInSeconds: 600, resendInSeconds: 60 });
    const mail = sendMailMock.mock.calls[0].arguments[0];
    const code = codeFromMail();
    assert.equal(mail.to, 'ana@acme.test');
    assert.match(mail.subject, new RegExp(`^${code} is your KGT AI Hub verification code`));
    assert.match(mail.html, new RegExp(`>${code}<`));
    assert.match(mail.html, /Valid for 10 minutes/);
    assert.match(mail.text, /Never share it/);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].codeHash, code);
    assert.ok(!JSON.stringify(rows[0]).includes(code), 'the code itself is never stored');
    const ttl = rows[0].expiresAt - Date.now();
    assert.ok(ttl > 9.9 * 60e3 && ttl <= 10 * 60e3);
  });

  test('a second request within 60s is refused with how long to wait', async () => {
    await sendSignupOtp('ana@acme.test');
    await assert.rejects(sendSignupOtp('ana@acme.test'), (e) => e.statusCode === 429 && e.extra.retryAfter > 55);
    assert.equal(sendMailMock.mock.callCount(), 1);
  });

  test('a new code replaces the old one and resets the attempts', async () => {
    await sendSignupOtp('ana@acme.test');
    const first = codeFromMail();
    rows[0].attempts = 3;
    rows[0].lastSentAt = new Date(Date.now() - 61e3);
    await sendSignupOtp('ana@acme.test');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].attempts, 0);
    if (first !== codeFromMail()) await rejects(verifySignupOtp('ana@acme.test', first), 400, /isn't right/);
  });

  test('a bad address, or one that already has an account, gets no email', async () => {
    await rejects(sendSignupOtp('not-an-email'), 400, /valid email/);
    users.push({ id: 'u1', email: 'taken@acme.test' });
    await rejects(sendSignupOtp('taken@acme.test'), 409, /already exists/);
    assert.equal(sendMailMock.mock.callCount(), 0);
  });

  test('when the email can\'t be sent: 502, and an immediate retry is allowed', async () => {
    mailResult = { sent: false, via: 'smtp', reason: 'auth' };
    await rejects(sendSignupOtp('ana@acme.test'), 502, /couldn't send/);
    mailResult = { sent: true, via: 'smtp' };
    await sendSignupOtp('ana@acme.test');
    assert.equal(sendMailMock.mock.callCount(), 2);
  });
});

describe('verifying a code', () => {
  beforeEach(() => sendSignupOtp('ana@acme.test'));

  test('the right code verifies the address and returns a signup token', async () => {
    const r = await verifySignupOtp('ANA@acme.test', codeFromMail());
    assert.equal(r.verified, true);
    assert.equal(r.email, 'ana@acme.test');
    assert.ok(r.verificationToken);
    assert.equal(rows[0].verified, true);
    assert.ok(rows[0].verifiedAt instanceof Date);
  });

  test('wrong codes count down, then lock — even the right code is refused after 5', async () => {
    const code = codeFromMail();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = MAX_ATTEMPTS - 1; left >= 1; left--) await rejects(verifySignupOtp('ana@acme.test', wrong), 400, new RegExp(`${left} attempts? left`));
    await rejects(verifySignupOtp('ana@acme.test', wrong), 429, /Too many wrong codes/);
    await rejects(verifySignupOtp('ana@acme.test', code), 429, /Too many wrong codes/);
    assert.equal(rows[0].verified, false);
  });

  test('parallel guesses can never exceed the attempt limit', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => verifySignupOtp('ana@acme.test', String(100000 + i))));
    assert.equal(rows[0].attempts, MAX_ATTEMPTS);
    assert.ok(results.filter((r) => r.status === 'rejected').length === 20);
  });

  test('an expired code is refused; malformed input never touches the attempts', async () => {
    await rejects(verifySignupOtp('ana@acme.test', '12ab56'), 400, /6-digit code/);
    assert.equal(rows[0].attempts, 0);
    rows[0].expiresAt = new Date(Date.now() - 1);
    await rejects(verifySignupOtp('ana@acme.test', codeFromMail()), 400, /invalid or has expired/);
  });
});

describe('claimVerification (used by /register/complete)', () => {
  const tx = { get emailVerification() { return ev; } };
  let token;
  beforeEach(async () => {
    await sendSignupOtp('ana@acme.test');
    ({ verificationToken: token } = await verifySignupOtp('ana@acme.test', codeFromMail()));
  });

  test('a valid token for a verified address is accepted exactly once', async () => {
    assert.equal(await claimVerification(tx, 'Ana@acme.test', token), true);
    assert.ok(rows[0].usedAt instanceof Date);
    assert.equal(await claimVerification(tx, 'ana@acme.test', token), false, 'one verification, one account');
  });

  test('refused: no token, another address, another token type, or a verification over 2 hours old', async () => {
    assert.equal(await claimVerification(tx, 'ana@acme.test', undefined), false);
    assert.equal(await claimVerification(tx, 'bob@acme.test', token), false);
    assert.equal(await claimVerification(tx, 'ana@acme.test', signToken('reset', { email: 'ana@acme.test', verificationId: rows[0].id })), false);
    rows[0].verifiedAt = new Date(Date.now() - 2.1 * 60 * 60 * 1000);
    assert.equal(await claimVerification(tx, 'ana@acme.test', token), false);
    assert.equal(rows[0].usedAt, null);
  });

  test('a token for a row that a new code request reset is no longer accepted', async () => {
    rows[0].lastSentAt = new Date(Date.now() - 61e3);
    await sendSignupOtp('ana@acme.test'); // resets verified to false
    assert.equal(await claimVerification(tx, 'ana@acme.test', token), false);
  });
});

describe('HTTP: /public/auth and the /register/complete gate', () => {
  let server;
  let base;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', wrapRouterAsync(require('../src/routes/publicAuth.routes')));
    app.use('/register', wrapRouterAsync(require('../src/routes/publicRegister.routes')));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  const post = async (path, body) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };

  test('send-otp -> verify-otp over HTTP, with errors as JSON', async () => {
    const sent = await post('/auth/send-otp', { email: 'carla@acme.test' });
    assert.equal(sent.status, 200);
    const again = await post('/auth/send-otp', { email: 'carla@acme.test' });
    assert.equal(again.status, 429);
    assert.ok(Number(again.headers.get('retry-after')) > 0);
    const wrong = await post('/auth/verify-otp', { email: 'carla@acme.test', otp: codeFromMail() === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.attemptsLeft, 4);
    const ok = await post('/auth/verify-otp', { email: 'carla@acme.test', otp: codeFromMail() });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.verified, true);
  });

  test('/register/complete refuses an unverified email with 403 and creates nothing', async () => {
    let created = 0;
    prisma.$transaction = async (fn) => fn({
      emailVerification: ev,
      tenant: { create: async () => { created++; return { id: 't1' }; } }
    });
    const res = await post('/register/complete', {
      companyName: 'Acme', email: 'dana@acme.test', password: 'a-long-password', industryLabel: 'Retail',
      pages: [{ title: 'About', content: 'We sell things.' }]
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(created, 0);
  });
});
