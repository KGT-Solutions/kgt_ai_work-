const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { assertProdSafety } = require('../src/utils/assertProdSafety');

describe('assertProdSafety — fail loudly on insecure config, but only when DEPLOY_ENV=production', () => {
  test('throws if DEV_BYPASS_AUTH is enabled when DEPLOY_ENV=production', () => {
    assert.throws(
      () => assertProdSafety({ DEPLOY_ENV: 'production', DEV_BYPASS_AUTH: 'true', JWT_SECRET: 'a-real-secret' }),
      /DEV_BYPASS_AUTH must not be enabled/
    );
  });

  test('throws if JWT_SECRET is unset when DEPLOY_ENV=production', () => {
    assert.throws(
      () => assertProdSafety({ DEPLOY_ENV: 'production' }),
      /JWT_SECRET must be set/
    );
  });

  test('throws if JWT_SECRET is still the committed placeholder value when DEPLOY_ENV=production', () => {
    assert.throws(
      () => assertProdSafety({ DEPLOY_ENV: 'production', JWT_SECRET: 'dev-secret-change-me' }),
      /JWT_SECRET must be set/
    );
  });

  test('does not throw when DEPLOY_ENV=production with a safe configuration', () => {
    assert.doesNotThrow(() =>
      assertProdSafety({
        DEPLOY_ENV: 'production', JWT_SECRET: 'a-real-secret', DEV_BYPASS_AUTH: 'false', CORS_ORIGINS: 'https://hub.example.com'
      })
    );
  });

  test('throws if CORS_ORIGINS is unset or blank when DEPLOY_ENV=production', () => {
    assert.throws(
      () => assertProdSafety({ DEPLOY_ENV: 'production', JWT_SECRET: 'a-real-secret' }),
      /CORS_ORIGINS must list/
    );
    assert.throws(
      () => assertProdSafety({ DEPLOY_ENV: 'production', JWT_SECRET: 'a-real-secret', CORS_ORIGINS: '  ' }),
      /CORS_ORIGINS must list/
    );
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
