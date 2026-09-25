const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  makeApiKey, hashApiKey, keyPrefix, issueApiKey, findValidApiKey, shouldTouchLastUsed
} = require('../src/utils/tenantApiKeys');

// Minimal stand-in for prisma.tenantApiKey, keyed by keyHash like the real unique index.
function fakeDb(rows = []) {
  const byHash = new Map(rows.map((r) => [r.keyHash, r]));
  return {
    tenantApiKey: {
      findUnique: async ({ where }) => byHash.get(where.keyHash) || null,
      create: async ({ data }) => {
        const row = { id: `key-${byHash.size + 1}`, revokedAt: null, lastUsedAt: null, ...data };
        byHash.set(row.keyHash, row);
        return row;
      }
    }
  };
}

describe('tenantApiKeys — key format and hashing', () => {
  test('keys are tk_ + 48 hex chars and never repeat', () => {
    const a = makeApiKey();
    assert.match(a, /^tk_[0-9a-f]{48}$/);
    assert.notEqual(a, makeApiKey());
  });

  test('hashApiKey is lowercase-hex SHA-256 of the UTF-8 key (what the migration backfill computes in SQL)', () => {
    // sha256("abc") — a published test vector; Postgres encode(sha256(convert_to('abc','UTF8')),'hex') gives the same.
    assert.equal(hashApiKey('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('keyPrefix keeps 9 chars, matching left("apiKey", 9) in the migration', () => {
    assert.equal(keyPrefix('tk_0123456789abcdef'), 'tk_012345');
  });
});

describe('tenantApiKeys — issuing and validating', () => {
  test('issueApiKey stores only the hash and returns the plaintext once', async () => {
    const db = fakeDb();
    const { key, row } = await issueApiKey(db, 'tenant-1', 'Website');
    assert.equal(row.keyHash, hashApiKey(key));
    assert.equal(row.keyPrefix, key.slice(0, 9));
    assert.equal(row.label, 'Website');
    assert.ok(!Object.values(row).includes(key), 'plaintext key must not be persisted');
  });

  test('accepts a live key belonging to the tenant', async () => {
    const db = fakeDb();
    const { key, row } = await issueApiKey(db, 'tenant-1');
    assert.equal((await findValidApiKey(db, 'tenant-1', key)).id, row.id);
  });

  test("rejects another tenant's key (no cross-tenant access)", async () => {
    const db = fakeDb();
    const { key } = await issueApiKey(db, 'tenant-1');
    assert.equal(await findValidApiKey(db, 'tenant-2', key), null);
  });

  test('rejects a revoked key', async () => {
    const db = fakeDb();
    const { key, row } = await issueApiKey(db, 'tenant-1');
    row.revokedAt = new Date();
    assert.equal(await findValidApiKey(db, 'tenant-1', key), null);
  });

  test('rejects unknown, empty, missing and non-string keys without throwing', async () => {
    const db = fakeDb();
    await issueApiKey(db, 'tenant-1');
    for (const bad of ['tk_nope', '', undefined, null, ['tk_x'], { key: 1 }]) {
      assert.equal(await findValidApiKey(db, 'tenant-1', bad), null);
    }
  });
});

describe('tenantApiKeys — lastUsedAt throttling', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');

  test('writes when never used', () => {
    assert.equal(shouldTouchLastUsed({ lastUsedAt: null }, now), true);
  });

  test('skips when used within the last few minutes', () => {
    assert.equal(shouldTouchLastUsed({ lastUsedAt: new Date(now - 60 * 1000) }, now), false);
  });

  test('writes again once the interval has passed', () => {
    assert.equal(shouldTouchLastUsed({ lastUsedAt: new Date(now - 6 * 60 * 1000) }, now), true);
  });
});
