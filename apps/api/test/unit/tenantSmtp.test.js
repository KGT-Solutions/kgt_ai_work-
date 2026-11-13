const { test, describe, before, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;

before(() => { process.env.ENCRYPTION_KEY = 'unit-test-master-secret-please-ignore'; });

const prisma = require('../../src/lib/prisma');
const { isEncrypted } = require('../../src/utils/encryption');
const nodemailer = require('nodemailer');
const { getMaskedConfig, upsertConfig, testConfig, resolveTenantTransport, SmtpConfigError, MASK, SMTP_PORTS } = require('../../src/services/tenantSmtp');

// In-memory stand-in for the single TenantSmtpConfig row, so these tests need
// no database: the Prisma model delegate is swapped for a tiny fake that upsert
// writes and findUnique reads back, then restored.
let stored = null;
let realDelegate;
beforeEach(() => {
  stored = null;
  realDelegate = prisma.tenantSmtpConfig;
  prisma.tenantSmtpConfig = {
    findUnique: async () => stored,
    upsert: async ({ create, update }) => {
      stored = { tenantId: 't1', ...(stored ? update : create) };
      return stored;
    }
  };
});
afterEach(() => { prisma.tenantSmtpConfig = realDelegate; });

const VALID = { smtpHost: 'smtp.acme.com', smtpPort: 587, smtpUser: 'alerts@acme.com', smtpPass: 's3cret-pw', smtpFrom: 'Acme <alerts@acme.com>' };

describe('tenantSmtp: storage is encrypted and never leaked', () => {
  test('the password is stored as ciphertext, never plaintext', async () => {
    await upsertConfig('t1', VALID);
    assert.ok(stored.smtpPass, 'a password was stored');
    assert.ok(isEncrypted(stored.smtpPass), 'stored password is ciphertext');
    assert.ok(!stored.smtpPass.includes('s3cret-pw'), 'plaintext never appears in storage');
  });

  test('getMaskedConfig returns the mask, never the ciphertext or plaintext', async () => {
    await upsertConfig('t1', VALID);
    const view = await getMaskedConfig('t1');
    assert.equal(view.smtpPass, MASK);
    assert.equal(view.hasPassword, true);
    assert.equal(view.smtpHost, 'smtp.acme.com');
    assert.notEqual(view.smtpPass, stored.smtpPass);
    assert.ok(!JSON.stringify(view).includes('s3cret-pw'));
  });

  test('no config yet returns a blank, unconfigured view', async () => {
    const view = await getMaskedConfig('t1');
    assert.deepEqual(view, { configured: false, isEnabled: false, provider: null, smtpHost: '', smtpPort: 587, smtpUser: '', smtpFrom: '', hasPassword: false, smtpPass: '' });
  });

  test('the chosen provider is stored and returned; an unknown provider is stored as null (custom)', async () => {
    await upsertConfig('t1', { ...VALID, provider: 'gmail' });
    assert.equal(stored.provider, 'gmail');
    assert.equal((await getMaskedConfig('t1')).provider, 'gmail');
    await upsertConfig('t1', { ...VALID, provider: 'yahoo', smtpPass: MASK });
    assert.equal(stored.provider, null);
  });
});

describe('tenantSmtp: saving with the mask keeps the stored password', () => {
  test('re-saving with smtpPass="********" does not change the ciphertext', async () => {
    await upsertConfig('t1', VALID);
    const original = stored.smtpPass;
    await upsertConfig('t1', { ...VALID, smtpPass: MASK, smtpFrom: 'Acme Support <alerts@acme.com>' });
    assert.equal(stored.smtpPass, original, 'ciphertext unchanged');
    assert.equal(stored.smtpFrom, 'Acme Support <alerts@acme.com>', 'other fields still update');
  });

  test('a real new password replaces the ciphertext', async () => {
    await upsertConfig('t1', VALID);
    const original = stored.smtpPass;
    await upsertConfig('t1', { ...VALID, smtpPass: 'a-new-password' });
    assert.notEqual(stored.smtpPass, original);
    assert.ok(isEncrypted(stored.smtpPass));
  });
});

describe('tenantSmtp: input validation', () => {
  const bad = (patch, re) => assert.rejects(() => upsertConfig('t1', { ...VALID, ...patch }),
    (e) => e instanceof SmtpConfigError && re.test(e.message));

  test('rejects a missing host, bad port, and malformed from address', async () => {
    await bad({ smtpHost: '   ' }, /smtpHost is required/);
    await bad({ smtpPort: 70000 }, /smtpPort/);
    await bad({ smtpPort: 'abc' }, /smtpPort/);
    await bad({ smtpFrom: 'not-an-email' }, /smtpFrom/);
  });

  test('requires a password when none is stored and none is given', async () => {
    await bad({ smtpPass: '' }, /smtpPass is required/);
  });
});

describe('tenantSmtp: resolveTenantTransport (used by the mailer)', () => {
  test('returns a decrypted, ready transport for an enabled config — dialling the checked IP, TLS verified by name', async () => {
    await upsertConfig('t1', { ...VALID, isEnabled: true });
    mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    const t = await resolveTenantTransport('t1');
    mock.restoreAll();
    assert.equal(t.from, 'Acme <alerts@acme.com>');
    assert.equal(t.config.host, '93.184.216.34', 'connects to the address that was checked, not the name');
    assert.equal(t.config.tls.servername, 'smtp.acme.com', 'the certificate is still verified for the hostname');
    assert.equal(t.config.auth.user, 'alerts@acme.com');
    assert.equal(t.config.auth.pass, 's3cret-pw'); // decrypted in memory for sending
    assert.equal(t.config.requireTLS, true); // STARTTLS on 587
  });

  test('returns null when disabled, so the mailer falls back to the platform SMTP', async () => {
    await upsertConfig('t1', { ...VALID, isEnabled: false });
    assert.equal(await resolveTenantTransport('t1'), null);
  });

  test('returns null when there is no config at all', async () => {
    assert.equal(await resolveTenantTransport('t1'), null);
  });

  test('a saved host that now resolves to a private address is never dialled — platform SMTP is used instead', async () => {
    await upsertConfig('t1', { ...VALID, isEnabled: true });
    mock.method(dns, 'lookup', async () => [{ address: '10.0.0.5', family: 4 }]);
    const t = await resolveTenantTransport('t1');
    mock.restoreAll();
    assert.equal(t, null);
  });

  test('a config saved before the port rules (e.g. port 6379) is refused at send time', async () => {
    await upsertConfig('t1', { ...VALID, isEnabled: true });
    stored.smtpPort = 6379; // as if written by an older version
    mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    const t = await resolveTenantTransport('t1');
    mock.restoreAll();
    assert.equal(t, null);
  });
});

describe('tenantSmtp: transport validation (no internal port scanning)', () => {
  const bad = (patch, re) => assert.rejects(() => upsertConfig('t1', { ...VALID, ...patch }),
    (e) => e instanceof SmtpConfigError && re.test(e.message));

  test('only the standard mail ports are accepted', async () => {
    assert.deepEqual(SMTP_PORTS, [25, 465, 587, 2525]);
    for (const port of SMTP_PORTS) await upsertConfig('t1', { ...VALID, smtpPort: port });
    for (const port of [22, 80, 443, 3306, 5432, 6379, 8080, 9200, 11211]) await bad({ smtpPort: port }, /SMTP port/);
  });

  test('a private or internal host is refused when it is saved', async () => {
    for (const smtpHost of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '169.254.169.254', '100.100.100.200', '::1', '[::1]', 'fd00::1', 'localhost', 'redis.internal', 'mail.local']) {
      await bad({ smtpHost }, /private network/);
    }
  });

  test('testConfig refuses a hostname resolving to a private address BEFORE connecting', async () => {
    mock.method(dns, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
    const created = mock.method(nodemailer, 'createTransport', () => { throw new Error('must not connect'); });
    const r = await testConfig('t1', { ...VALID, smtpHost: 'rebind.attacker.example' });
    assert.equal(created.mock.callCount(), 0, 'no transport was ever created');
    mock.restoreAll();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid');
    assert.match(r.error, /private network/);
  });

  test('testConfig refuses an unresolvable host with a fixed message', async () => {
    mock.method(dns, 'lookup', async () => { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; });
    const r = await testConfig('t1', { ...VALID, smtpHost: 'nope.example' });
    mock.restoreAll();
    assert.equal(r.reason, 'invalid');
    assert.match(r.error, /Could not find the SMTP server/);
  });

  test('a failed test never echoes the remote server\'s banner, raw response or the platform\'s config', async () => {
    mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    const BANNER = 'SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.6 internal-db-01';
    const cases = [
      Object.assign(new Error(`Invalid greeting. response=${BANNER}`), { code: 'EPROTOCOL', response: BANNER }),
      Object.assign(new Error('Invalid login: 535 5.7.8 auth failed on mx-internal.corp'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 mx-internal.corp' }),
      Object.assign(new Error('connect ECONNREFUSED 93.184.216.34:587'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' })
    ];
    for (const failure of cases) {
      mock.method(nodemailer, 'createTransport', () => ({ verify: async () => { throw failure; }, close() {} }));
      const r = await testConfig('t1', VALID);
      const text = JSON.stringify(r);
      assert.equal(r.ok, false);
      assert.ok(r.error && r.hint, 'a fixed, helpful message is still returned');
      for (const leak of ['OpenSSH', 'internal-db-01', 'mx-internal', '93.184.216.34', 'ECONNREFUSED', 'SMTP_HOST', 'response=']) {
        assert.ok(!text.includes(leak), `"${leak}" leaked in ${text}`);
      }
    }
    mock.restoreAll();
  });

  test('a successful test dials the checked IP with TLS verified for the hostname', async () => {
    mock.method(dns, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
    let cfg;
    mock.method(nodemailer, 'createTransport', (c) => { cfg = c; return { verify: async () => true, close() {} }; });
    const r = await testConfig('t1', VALID);
    mock.restoreAll();
    assert.deepEqual(r, { ok: true });
    assert.equal(cfg.host, '93.184.216.34');
    assert.equal(cfg.tls.servername, 'smtp.acme.com');
  });
});
