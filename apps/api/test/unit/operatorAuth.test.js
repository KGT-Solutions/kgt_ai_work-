const { test, describe, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const prisma = require('../../src/lib/prisma');
const { requireOperator, signOperatorToken } = require('../../src/middleware/operatorAuth');

// The operator revocation kill-switch (middleware/operatorAuth.js): a token older
// than a password change, or belonging to a deactivated account, must be refused
// on its next request. prisma is mocked, so this runs in the unit layer.

function iatOf(token) {
  return jwt.decode(token).iat;
}

// Drives the middleware with a token and a stubbed operator row; returns what it did.
async function run(token, operatorRow) {
  const original = prisma.operator.findUnique;
  prisma.operator.findUnique = async () => operatorRow;
  try {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const out = { status: 200, body: null, nexted: false };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    const next = () => { out.nexted = true; };
    await requireOperator(req, res, next);
    out.req = req;
    return out;
  } finally {
    prisma.operator.findUnique = original;
  }
}

const OP = (over = {}) => ({ id: 'op1', email: 'a@b.test', name: 'Admin', passwordChangedAt: null, active: true, ...over });

describe('operatorAuth: revocation kill-switch', () => {
  afterEach(() => mock.restoreAll());

  test('a valid token for an active operator passes through', async () => {
    const token = signOperatorToken({ id: 'op1' });
    const out = await run(token, OP());
    assert.equal(out.nexted, true);
    assert.equal(out.req.operator.id, 'op1');
    assert.equal(out.req.operator.passwordChangedAt, undefined, 'internal fields are not leaked onto req.operator');
  });

  test('a token issued BEFORE the password change is rejected with 401', async () => {
    const token = signOperatorToken({ id: 'op1' });
    const changedAfter = new Date((iatOf(token) + 2) * 1000); // password changed 2s after mint
    const out = await run(token, OP({ passwordChangedAt: changedAfter }));
    assert.equal(out.nexted, false);
    assert.equal(out.status, 401);
  });

  test('a token minted in the SAME second as the change is rejected (same-second race closed)', async () => {
    const token = signOperatorToken({ id: 'op1' });
    const sameSecond = new Date(iatOf(token) * 1000);
    const out = await run(token, OP({ passwordChangedAt: sameSecond }));
    assert.equal(out.status, 401);
  });

  test('a token issued AFTER the last password change is accepted', async () => {
    const token = signOperatorToken({ id: 'op1' });
    const changedBefore = new Date((iatOf(token) - 10) * 1000);
    const out = await run(token, OP({ passwordChangedAt: changedBefore }));
    assert.equal(out.nexted, true);
  });

  test('a deactivated operator is blocked with 403', async () => {
    const token = signOperatorToken({ id: 'op1' });
    const out = await run(token, OP({ active: false }));
    assert.equal(out.nexted, false);
    assert.equal(out.status, 403);
  });

  test('a missing token is 401, and an unknown operator is 401', async () => {
    assert.equal((await run(null, OP())).status, 401);
    const token = signOperatorToken({ id: 'ghost' });
    assert.equal((await run(token, null)).status, 401);
  });
});
