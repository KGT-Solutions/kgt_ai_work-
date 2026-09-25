const crypto = require('crypto');

// Tenant API keys (TenantApiKey in schema.prisma). Only the SHA-256 hash is
// stored. A plain unsalted hash is enough here: the keys are 192 random bits,
// so there's nothing to brute-force or look up in a rainbow table, and an
// unsalted hash is what lets a request's key be found with one indexed lookup.
//
// hashApiKey must stay in step with the backfill in
// prisma/migrations/20260924120000_tenant_api_keys_and_consent.

const KEY_PREFIX_LENGTH = 9; // "tk_" + 6 hex chars — enough to tell keys apart, useless for guessing
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function makeApiKey() {
  return `tk_${crypto.randomBytes(24).toString('hex')}`;
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

function keyPrefix(key) {
  return String(key).slice(0, KEY_PREFIX_LENGTH);
}

// Creates a key row and returns the plaintext — the only time it's ever
// available. `db` is the prisma client or a transaction client.
async function issueApiKey(db, tenantId, label = 'Default') {
  const key = makeApiKey();
  const row = await db.tenantApiKey.create({
    data: { tenantId, keyHash: hashApiKey(key), keyPrefix: keyPrefix(key), label }
  });
  return { key, row };
}

// The key row for `providedKey` if it's a live key belonging to `tenantId`,
// else null. A key for a different tenant is rejected the same way as an
// unknown one, so callers can't probe which tenant a key belongs to.
async function findValidApiKey(db, tenantId, providedKey) {
  if (!providedKey || typeof providedKey !== 'string') return null;
  const row = await db.tenantApiKey.findUnique({ where: { keyHash: hashApiKey(providedKey) } });
  if (!row || row.tenantId !== tenantId || row.revokedAt) return null;
  return row;
}

// Bumps lastUsedAt at most once per interval — a write on every chat
// message would be pure overhead for a value only ever shown as "last used".
function shouldTouchLastUsed(row, now = Date.now()) {
  return !row.lastUsedAt || now - new Date(row.lastUsedAt).getTime() > LAST_USED_WRITE_INTERVAL_MS;
}

module.exports = { makeApiKey, hashApiKey, keyPrefix, issueApiKey, findValidApiKey, shouldTouchLastUsed, KEY_PREFIX_LENGTH };
