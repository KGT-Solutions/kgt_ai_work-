const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// prisma/seed.js seedOperator: the staff account follows HUB_ADMIN_EMAIL /
// HUB_ADMIN_PASSWORD on every start. Its Prisma client is replaced by an
// in-memory operator table.

const { seedOperator, prisma } = require('../../prisma/seed');
const { hashPassword, verifyPassword } = require('../../src/utils/password');

const VARS = ['HUB_ADMIN_EMAIL', 'HUB_ADMIN_PASSWORD', 'HUB_ADMIN_NAME', 'DEPLOY_ENV'];
let operators, logs, saved, mocks;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  operators = [];
  logs = [];
  prisma.operator.findUnique = async ({ where }) => operators.find((o) => o.email === where.email) || null;
  prisma.operator.create = async ({ data }) => { const o = { id: `o${operators.length + 1}`, ...data }; operators.push(o); return o; };
  prisma.operator.update = async ({ where, data }) => Object.assign(operators.find((o) => o.id === where.id), data);
  prisma.operator.findMany = async ({ where }) => operators.filter((o) => o.email !== where.email.not);
  mocks = ['log', 'warn', 'error'].map((level) => mock.method(console, level, (...a) => logs.push(`${level}: ${a.join(' ')}`)));
});
afterEach(() => {
  for (const m of mocks) m.mock.restore();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const env = (email, password, extra = {}) => Object.assign(process.env, { HUB_ADMIN_EMAIL: email, HUB_ADMIN_PASSWORD: password, ...extra });

describe('seedOperator', () => {
  test('first start: creates the operator with a hashed password, email lower-cased', async () => {
    env(' Admin@KGT.test ', 'first-password-123');
    await seedOperator();
    assert.equal(operators.length, 1);
    assert.equal(operators[0].email, 'admin@kgt.test');
    assert.ok(verifyPassword('first-password-123', operators[0].passwordHash));
    assert.ok(!operators[0].passwordHash.includes('first-password-123'));
  });

  test('a changed HUB_ADMIN_PASSWORD replaces the stored one on the next start', async () => {
    operators.push({ id: 'o1', email: 'admin@kgt.test', passwordHash: hashPassword('old-password-123') });
    env('admin@kgt.test', 'new-password-456');
    await seedOperator();
    assert.ok(verifyPassword('new-password-456', operators[0].passwordHash));
    assert.ok(!verifyPassword('old-password-123', operators[0].passwordHash));
    assert.ok(logs.some((l) => /password updated to match HUB_ADMIN_PASSWORD/.test(l)));
    assert.ok(!logs.some((l) => /new-password-456/.test(l)), 'a real password is never logged');
  });

  test('an unchanged password is not rewritten', async () => {
    const hash = hashPassword('same-password-123');
    operators.push({ id: 'o1', email: 'admin@kgt.test', passwordHash: hash });
    env('admin@kgt.test', 'same-password-123');
    await seedOperator();
    assert.equal(operators[0].passwordHash, hash);
    assert.ok(logs.some((l) => /password matches HUB_ADMIN_PASSWORD — unchanged/.test(l)));
  });

  test('a new HUB_ADMIN_EMAIL creates that operator and names the old one, without deleting it', async () => {
    operators.push({ id: 'o1', email: 'old-admin@kgt.test', passwordHash: hashPassword('old-password-123') });
    env('new-admin@kgt.test', 'new-password-456');
    await seedOperator();
    assert.deepEqual(operators.map((o) => o.email), ['old-admin@kgt.test', 'new-admin@kgt.test']);
    assert.ok(logs.some((l) => /^warn: .*1 other operator account\(s\) still exist \(old-admin@kgt\.test\)/.test(l)));
  });

  test('production never downgrades a real password to the placeholder', async () => {
    operators.push({ id: 'o1', email: 'admin@kgt.test', passwordHash: hashPassword('a-real-strong-password') });
    env('admin@kgt.test', 'change-me-please', { DEPLOY_ENV: 'production' });
    await seedOperator();
    assert.ok(verifyPassword('a-real-strong-password', operators[0].passwordHash), 'kept the real password');
    assert.ok(logs.some((l) => /^error: .*HUB_ADMIN_PASSWORD is still the placeholder/.test(l)));
  });

  test('outside production the placeholder is allowed (local setups), with a warning on creation', async () => {
    env('admin@kgt.test', 'change-me-please');
    await seedOperator();
    assert.ok(verifyPassword('change-me-please', operators[0].passwordHash));
    assert.ok(logs.some((l) => /uses the placeholder password/.test(l)));
  });

  test('missing settings skip; a short password stops the seed', async () => {
    await seedOperator();
    assert.equal(operators.length, 0);
    env('admin@kgt.test', 'short');
    await assert.rejects(seedOperator(), /at least 10 characters/);
  });
});
