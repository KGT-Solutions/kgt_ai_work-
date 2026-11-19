const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { assertProdSafety, jwtSecretProblem, ProdSafetyError, MIN_SECRET_LENGTH } = require('../../src/utils/assertProdSafety');

const REAL_SECRET = '9f2c4e7a1b8d3f6e0a5c2b9d7e4f1a3c'; // the shape `openssl rand -hex 16` prints
const REAL_ENC_KEY = '3a7d1f9c5e2b8406d7c1a9f4e6b2083d'; // a distinct real secret for ENCRYPTION_KEY
// A fully valid production config: every gate below starts from this and breaks
// exactly one thing, so a failure is unambiguous.
const SAFE = {
  DEPLOY_ENV: 'production', JWT_SECRET: REAL_SECRET, CORS_ORIGINS: 'https://hub.example.com',
  ENCRYPTION_KEY: REAL_ENC_KEY, SHARED_STORE: 'redis', REDIS_URL: 'redis://redis:6379'
};

describe('assertProdSafety — fail loudly on insecure config, but only when DEPLOY_ENV=production', () => {
  test('throws if DEV_BYPASS_AUTH is enabled when DEPLOY_ENV=production', () => {
    assert.throws(() => assertProdSafety({ ...SAFE, DEV_BYPASS_AUTH: 'true' }), /DEV_BYPASS_AUTH must not be enabled/);
  });

  test('throws if JWT_SECRET is unset when DEPLOY_ENV=production, saying so', () => {
    assert.throws(() => assertProdSafety({ ...SAFE, JWT_SECRET: undefined }), /JWT_SECRET must be set.*because it is not set/);
  });

  test('throws if JWT_SECRET is still the committed placeholder value, naming it', () => {
    assert.throws(
      () => assertProdSafety({ ...SAFE, JWT_SECRET: 'dev-secret-change-me' }),
      /JWT_SECRET must be set.*still the committed placeholder "dev-secret-change-me"/
    );
  });

  test('does not throw when DEPLOY_ENV=production with a safe configuration', () => {
    assert.doesNotThrow(() => assertProdSafety({ ...SAFE, DEV_BYPASS_AUTH: 'false' }));
  });

  test('throws if CORS_ORIGINS is unset or blank when DEPLOY_ENV=production', () => {
    assert.throws(() => assertProdSafety({ ...SAFE, CORS_ORIGINS: undefined }), /CORS_ORIGINS must list/);
    assert.throws(() => assertProdSafety({ ...SAFE, CORS_ORIGINS: '  ' }), /CORS_ORIGINS must list/);
  });

  test('throws if ENCRYPTION_KEY is missing, placeholder or too weak when DEPLOY_ENV=production', () => {
    assert.throws(() => assertProdSafety({ ...SAFE, ENCRYPTION_KEY: undefined }), /ENCRYPTION_KEY must be set.*because it is not set/);
    assert.throws(() => assertProdSafety({ ...SAFE, ENCRYPTION_KEY: 'change-me' }), /ENCRYPTION_KEY must be set/);
    assert.throws(() => assertProdSafety({ ...SAFE, ENCRYPTION_KEY: 'short1!' }), /ENCRYPTION_KEY must be set/);
  });

  test('never prints the ENCRYPTION_KEY it rejected', () => {
    const weak = 'tiny-key-9';
    assert.throws(() => assertProdSafety({ ...SAFE, ENCRYPTION_KEY: weak }), (e) => !e.message.includes(weak));
  });

  test('requires SHARED_STORE=redis (with REDIS_URL) in production unless a single replica is declared', () => {
    // The default/in-process store is rejected when more than one replica runs.
    assert.throws(() => assertProdSafety({ ...SAFE, SHARED_STORE: 'memory' }), /SHARED_STORE must be "redis"/);
    assert.throws(() => assertProdSafety({ ...SAFE, SHARED_STORE: undefined }), /SHARED_STORE must be "redis"/);
    // redis selected but no connection string is its own distinct problem.
    assert.throws(() => assertProdSafety({ ...SAFE, REDIS_URL: undefined }), /SHARED_STORE=redis requires REDIS_URL/);
    // A deliberate single-container deployment may opt out of Redis entirely.
    assert.doesNotThrow(() => assertProdSafety({ ...SAFE, SHARED_STORE: 'memory', REDIS_URL: undefined, API_REPLICAS: '1' }));
  });

  test('reports every problem in one error, with a fix for each and the env-file reload hint', () => {
    let err;
    try { assertProdSafety({ DEPLOY_ENV: 'production', JWT_SECRET: 'dev-secret-change-me', DEV_BYPASS_AUTH: 'true' }); } catch (e) { err = e; }
    assert.ok(err instanceof ProdSafetyError);
    // Everything missing at once: bypass on, placeholder JWT, no ENCRYPTION_KEY,
    // no CORS_ORIGINS, and the default (memory) shared store with >1 replica.
    assert.deepEqual(err.problems.map((p) => p.key), ['DEV_BYPASS_AUTH', 'JWT_SECRET', 'ENCRYPTION_KEY', 'CORS_ORIGINS', 'SHARED_STORE']);
    assert.match(err.message, /5 configuration problems/);
    assert.match(err.message, /openssl rand -hex 32/);
    assert.match(err.message, /docker compose --env-file \.env\.docker up -d api/);
  });

  test('never prints the secret it rejected', () => {
    const tooShort = 'Short1!';
    assert.throws(() => assertProdSafety({ ...SAFE, JWT_SECRET: tooShort }), (e) => !e.message.includes(tooShort));
  });

  test('never throws when DEPLOY_ENV is not "production" — regardless of NODE_ENV, DEV_BYPASS_AUTH, or JWT_SECRET', () => {
    // This is the exact shape of this project's own docker-compose stack:
    // NODE_ENV=production (set unconditionally in the Dockerfile, for
    // Express's own behavior) with DEV_BYPASS_AUTH=true (committed in
    // .env.docker for local/staging convenience) and no DEPLOY_ENV set at
    // all — must never throw, or every container boot crash-loops before
    // app.listen() runs (this exact regression shipped once already).
    assert.doesNotThrow(() =>
      assertProdSafety({ NODE_ENV: 'production', DEV_BYPASS_AUTH: 'true', JWT_SECRET: 'dev-secret-change-me' })
    );
    assert.doesNotThrow(() => assertProdSafety({ NODE_ENV: 'production' }));
    assert.doesNotThrow(() => assertProdSafety({ DEPLOY_ENV: 'staging', DEV_BYPASS_AUTH: 'true' }));
    assert.doesNotThrow(() => assertProdSafety({}));
  });
});

describe('jwtSecretProblem — which production secrets are accepted', () => {
  test(`any non-placeholder value of ${MIN_SECRET_LENGTH}+ characters is accepted`, () => {
    for (const ok of [
      REAL_SECRET,
      'kgt-ai-hub-prod-2026-x7Q', // a human-chosen passphrase with a "-" in it
      'correct horse battery staple', // spaces are fine inside the value
      'aaaabcdefgh12345', // exactly 16 characters, varied enough
      'My$ecretKey#2026!' // contains the word "secret" but is not just "secret"
    ]) assert.equal(jwtSecretProblem(ok), null, ok);
  });

  test('values that are missing, padded, too short or monotonous are rejected, each with its reason', () => {
    const cases = [
      [undefined, /not set/],
      ['', /not set/],
      ['    ', /only whitespace/],
      [` ${REAL_SECRET}`, /leading or trailing whitespace/],
      ['abc123', /6 characters long; at least 16/],
      ['15-chars-long!!', /15 characters long/],
      ['aaaaaaaaaaaaaaaaaaaaaaaa', /too few distinct characters/]
    ];
    for (const [value, reason] of cases) assert.match(jwtSecretProblem(value), reason, String(value));
  });

  test('well-known placeholders are rejected whatever their case or separators', () => {
    for (const p of ['dev-secret-change-me', 'secret', 'SECRET', 'change_me', 'Change-Me-Please', 'jwt_secret', 'your-jwt-secret', 'supersecret'])
      assert.notEqual(jwtSecretProblem(p), null, p);
    for (const p of ['my-prod-secret-changeme-2026', 'replace-me-with-something-long', 'https://example.com/long-value-here'])
      assert.match(jwtSecretProblem(p), /placeholder text/, p);
  });

  test('surrounding quotes are not counted toward the length', () => {
    assert.match(jwtSecretProblem('"only-14-chars!"'), /14 characters long/); // 16 with the quotes
    assert.equal(jwtSecretProblem(`"${REAL_SECRET}"`), null);
  });
});
