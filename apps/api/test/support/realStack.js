// Shared setup for the layers that run against a REAL PostgreSQL database
// (test/db, test/system): the whole Express app, real Prisma, real SQL.
//
//   TEST_DATABASE_URL=postgresql://kgthub:kgthub@localhost:5440/kgt_test?schema=public npm run test:db
//
// Safety rails, because these tests write to the database:
//   - TEST_DATABASE_URL is required (without it these suites are skipped, not
//     failed), and its database name must contain "test" — so a production or
//     dev DATABASE_URL can never be used by accident;
//   - every LLM key, SMTP and Resend setting is blanked before the app loads,
//     so no test can call an AI provider or send an email, even with a real
//     apps/api/.env on the machine (dotenv never overrides a set variable);
//   - tests create rows under unique names and delete only their own tenants
//     (cascade), so test files can run in parallel against one database.

const crypto = require('crypto');

const TEST_URL = process.env.TEST_DATABASE_URL || '';

function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

const skipReason = !TEST_URL
  ? 'TEST_DATABASE_URL is not set (see /TESTING.md)'
  : !/test/i.test(databaseName(TEST_URL))
    ? `refusing to run: the database name "${databaseName(TEST_URL)}" must contain "test"`
    : false;

let loaded = null;

/** Configures the environment and loads the app. Call only when !skipReason. */
function loadStack() {
  if (loaded) return loaded;
  if (skipReason) throw new Error(skipReason);
  Object.assign(process.env, {
    DATABASE_URL: TEST_URL,
    JWT_SECRET: 'real-stack-test-secret-not-for-production',
    NODE_ENV: 'test',
    // No external calls, whatever .env says.
    GROQ_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '',
    SMTP_HOST: '', RESEND_API_KEY: '', SMTP_FROM: '', MAIL_FROM: '', EMAIL_FROM: '',
    TRUST_PROXY_HOPS: '1' // tests set X-Forwarded-For to get their own rate-limit bucket
  });
  // Set, not deleted. Requiring the app below runs dotenv.config(), which
  // fills in any key that is ABSENT from process.env — so deleting this put a
  // developer's own apps/api/.env back in charge, and a local DEPLOY_ENV=production
  // made the whole suite run in production mode (the mailer then reports every
  // send as failed, with no transport configured, and the signup-code rate-limit
  // test sees 502s instead of 200s). An explicit non-production value cannot be
  // overridden. The Docker test stack never hit this: .dockerignore keeps .env
  // out of the image.
  process.env.DEPLOY_ENV = 'test';
  const app = require('../../src/app');
  const prisma = require('../../src/lib/prisma');
  loaded = { app, prisma };
  return loaded;
}

/** Starts the app on a random port: { base, close }. */
async function startServer(app) {
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const uid = (prefix = 't') => `${prefix}-${crypto.randomBytes(5).toString('hex')}`;

// A distinct client IP per call site, so per-IP rate limits never leak between tests.
let ipCounter = 0;
const freshIp = () => { ipCounter += 1; return `203.0.113.${(ipCounter % 250) + 1}`; };

/**
 * JSON over HTTP against the running app.
 * @returns {Promise<{ status: number, body: any, headers: Headers }>}
 */
async function http(base, method, path, { body, token, apiKey, ip, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip || freshIp(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'x-tenant-api-key': apiKey } : {}),
      ...headers
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
}

/**
 * A complete tenant straight in the database: company, client login,
 * documents, an API key. Returns what the tests need to act as it.
 */
async function createTenant(prisma, { name = 'Acme', password = 'tenant-password-123', documents = [], botPreference = 'both' } = {}) {
  const { hashPassword } = require('../../src/utils/password');
  const { issueApiKey } = require('../../src/utils/tenantApiKeys');
  const slug = uid(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const email = `${slug}@example.test`;
  const tenant = await prisma.tenant.create({ data: { name, slug, industryLabel: 'Testing', botPreference } });
  await prisma.tenantUser.create({ data: { tenantId: tenant.id, email, passwordHash: hashPassword(password) } });
  const { key } = await issueApiKey(prisma, tenant.id, 'test');
  if (documents.length) {
    await prisma.tenantDocument.createMany({ data: documents.map((d) => ({ tenantId: tenant.id, category: 'FAQ', ...d })) });
  }
  return { tenant, email, password, apiKey: key };
}

async function signIn(base, { email, password }) {
  const r = await http(base, 'POST', '/api/v1/client/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

/** Deletes the given tenants (everything they own cascades with them). */
async function dropTenants(prisma, tenants) {
  const ids = tenants.filter(Boolean).map((t) => t.tenant?.id || t.id);
  if (ids.length) await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

module.exports = { skipReason, loadStack, startServer, http, createTenant, signIn, dropTenants, uid, freshIp, databaseName, TEST_URL };
