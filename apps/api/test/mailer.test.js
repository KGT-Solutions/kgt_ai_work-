const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// services/mailer.js: SMTP settings, sender and alert-list parsing, and what
// reaches nodemailer. nodemailer.createTransport is mocked, so nothing
// connects anywhere.

const nodemailer = require('nodemailer');
const sent = [];
let failWith = null;
const createTransportMock = mock.method(nodemailer, 'createTransport', () => ({
  sendMail: async (msg) => { if (failWith) throw failWith; sent.push(msg); return { messageId: 'x' }; },
  verify: async () => true,
  close: () => {}
}));
const {
  sendMail, smtpConfig, mailFrom, mailConfigured, classifyMailError, verifyMailer, maskAddress
} = require('../src/services/mailer');

const VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'MAIL_FROM', 'EMAIL_FROM',
  'RESEND_API_KEY', 'DEPLOY_ENV', 'NODE_ENV'];

// Runs fn with console.error / console.warn / console.log captured.
async function captureLogs(fn) {
  const logs = { error: [], warn: [], log: [] };
  const mocks = Object.keys(logs).map((level) => mock.method(console, level, (...args) => logs[level].push(args.join(' '))));
  try {
    return { result: await fn(), logs };
  } finally {
    for (const m of mocks) m.mock.restore();
  }
}
let saved;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  sent.length = 0;
  failWith = null;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const office365 = () => Object.assign(process.env, {
  SMTP_HOST: 'smtp.office365.com', SMTP_PORT: '587', SMTP_USER: 'connect@kgt.test', SMTP_PASS: 'app-password',
  SMTP_FROM: 'KGT Solutions <connect@kgt.test>'
});

describe('SMTP settings', () => {
  test('port 587 requires STARTTLS; 465 is implicit TLS; SMTP_SECURE overrides', () => {
    office365();
    assert.deepEqual(
      (({ host, port, secure, requireTLS, auth }) => ({ host, port, secure, requireTLS, auth }))(smtpConfig()),
      { host: 'smtp.office365.com', port: 587, secure: false, requireTLS: true, auth: { user: 'connect@kgt.test', pass: 'app-password' } }
    );
    process.env.SMTP_PORT = '465';
    assert.equal(smtpConfig().secure, true);
    assert.equal(smtpConfig().requireTLS, false);
    process.env.SMTP_SECURE = 'false';
    assert.equal(smtpConfig().secure, false);
  });

  test('no SMTP_HOST means no SMTP; the port defaults to 587', () => {
    assert.equal(smtpConfig(), null);
    assert.equal(mailConfigured(), false);
    process.env.SMTP_HOST = 'smtp.example.com';
    assert.equal(smtpConfig().port, 587);
  });

  test('sender: SMTP_FROM, then MAIL_FROM / EMAIL_FROM, then the SMTP login', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'login@kgt.test';
    assert.equal(mailFrom(), 'login@kgt.test');
    process.env.EMAIL_FROM = 'Old <old@kgt.test>';
    assert.equal(mailFrom(), 'Old <old@kgt.test>');
    process.env.SMTP_FROM = 'KGT <connect@kgt.test>';
    assert.equal(mailFrom(), 'KGT <connect@kgt.test>');
  });

});

describe('sendMail over SMTP', () => {
  test('sends through nodemailer from exactly SMTP_FROM, over STARTTLS', async () => {
    Object.assign(process.env, {
      SMTP_HOST: 'smtp.office365.com', SMTP_PORT: '587', SMTP_USER: 'connect@kgt.solutions', SMTP_PASS: 'app-password',
      SMTP_FROM: 'KGT Solutions <connect@kgt.solutions>'
    });
    const result = await sendMail({ to: 'ana@x.com', subject: 'Hi', text: 'Body', html: '<p>Body</p>', replyTo: 'r@x.com' });
    assert.deepEqual(result, { sent: true, via: 'smtp' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, 'KGT Solutions <connect@kgt.solutions>');
    assert.deepEqual(sent[0].to, ['ana@x.com']);
    assert.equal(sent[0].replyTo, 'r@x.com');
    const config = createTransportMock.mock.calls.at(-1).arguments[0];
    assert.equal(config.host, 'smtp.office365.com');
    assert.equal(config.requireTLS, true);
    assert.deepEqual(config.auth, { user: 'connect@kgt.solutions', pass: 'app-password' });
  });

  test('without SMTP_FROM the sender is the SMTP login itself', async () => {
    Object.assign(process.env, { SMTP_HOST: 'smtp.office365.com', SMTP_USER: 'connect@kgt.solutions', SMTP_PASS: 'app-password' });
    await sendMail({ to: 'ana@x.com', subject: 'Hi', text: 'x' });
    assert.equal(sent[0].from, 'connect@kgt.solutions');
  });

  test('a rejected login: a prominent, classified error with a fix — never the password', async () => {
    office365();
    failWith = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.3 Authentication unsuccessful' });
    const { result, logs } = await captureLogs(() => sendMail({ to: 'ana@x.com', subject: 'Hi', text: 'Body', label: 'visitor confirmation, lead l1' }));
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'auth');
    assert.equal(result.transient, false);
    const out = logs.error.join('\n');
    assert.match(out, /ERROR: email NOT sent \(visitor confirmation, lead l1\) to an\*\*\*@x\.com via smtp: auth/);
    assert.match(out, /535 5\.7\.3/);
    assert.match(out, /fix: SMTP login refused/);
    assert.doesNotMatch(out, /app-password/);
  });
});

describe('failure classification', () => {
  const cases = [
    [{ code: 'EAUTH', responseCode: 535 }, 'auth', false],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, 'timeout', true],
    [{ code: 'ESOCKET', message: 'connect ECONNREFUSED 1.2.3.4:587' }, 'connection', true],
    [{ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.nope' }, 'connection', true],
    [{ code: 'ETLS', message: 'wrong version number' }, 'tls', false],
    [{ code: 'EENVELOPE', responseCode: 550, response: '550 5.7.60 SMTP; Client does not have permissions to send as this sender' }, 'rejected', false],
    [{ code: 'EMESSAGE', responseCode: 451, response: '451 4.7.0 Temporary server error' }, 'temporary', true],
    [{ message: 'something odd' }, 'unknown', false]
  ];
  for (const [err, reason, transient] of cases) {
    test(`${err.code || 'no code'} ${err.responseCode || ''} -> ${reason}`, () => {
      const c = classifyMailError(Object.assign(new Error(err.message || err.response || ''), err));
      assert.equal(c.reason, reason);
      assert.equal(c.transient, transient);
      assert.ok(c.hint.length > 10);
    });
  }

  test('addresses in logs keep the domain (to spot typos) but not the whole address', () => {
    assert.equal(maskAddress('meaakarsh25@gamil.com'), 'me***@gamil.com');
  });
});

describe('no transport configured', () => {
  test('outside production: printed, flagged as simulated (not a delivery)', async () => {
    const { result, logs } = await captureLogs(() => sendMail({ to: 'ana@x.com', subject: 'Hi', text: 'Body' }));
    assert.deepEqual(result, { sent: true, via: 'dev-log', simulated: true });
    assert.match(logs.warn.join('\n'), /NOT delivered/);
  });

  for (const [name, value] of [['DEPLOY_ENV', 'production'], ['NODE_ENV', 'production']]) {
    test(`${name}=production: refused, loudly, with the fix — and the body is never printed`, async () => {
      process.env[name] = value;
      const { result, logs } = await captureLogs(() => sendMail({ to: 'ana@x.com', subject: 'Code', text: 'Your code is 123456' }));
      assert.equal(result.sent, false);
      assert.equal(result.reason, 'not-configured');
      const out = [...logs.error, ...logs.warn, ...logs.log].join('\n');
      assert.match(out, /ERROR: email NOT sent/);
      assert.match(out, /\.env\.docker/);
      assert.doesNotMatch(out, /123456/);
      assert.equal(sent.length, 0);
    });
  }

  test('the startup check reports production and the fix', async () => {
    process.env.NODE_ENV = 'production';
    const m = await verifyMailer();
    assert.equal(m.transport, null);
    assert.equal(m.production, true);
    assert.match(m.hint, /docker compose --env-file \.env\.docker up -d api/);
  });
});
