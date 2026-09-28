const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signToken, verifyToken } = require('../src/utils/authTokens');

describe('authTokens — operator and client sessions never stand in for each other', () => {
  test('each token verifies only as its own type', () => {
    const op = signToken('operator', { operatorId: 'o1' });
    const cl = signToken('client', { tenantUserId: 'u1' });
    assert.equal(verifyToken(op, 'operator').operatorId, 'o1');
    assert.equal(verifyToken(cl, 'client').tenantUserId, 'u1');
    assert.equal(verifyToken(op, 'client'), null, 'operator token must not open client routes');
    assert.equal(verifyToken(cl, 'operator'), null, 'client token must not open staff routes');
  });

  test('a client token carries no tenantId — the tenant always comes from the database', () => {
    const claims = verifyToken(signToken('client', { tenantUserId: 'u1' }), 'client');
    assert.equal('tenantId' in claims, false);
  });

  test('untyped, forged, tampered and garbage tokens are rejected', () => {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    assert.equal(verifyToken(jwt.sign({ operatorId: 'o1' }, secret), 'operator'), null, 'no typ');
    assert.equal(verifyToken(jwt.sign({ operatorId: 'o1', typ: 'operator' }, 'another-secret'), 'operator'), null, 'wrong secret');
    const [h, p, s] = signToken('client', { tenantUserId: 'u1' }).split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ tenantUserId: 'u2', typ: 'operator' })).toString('base64url');
    assert.equal(verifyToken(`${h}.${forgedPayload}.${s}`, 'operator'), null, 'tampered payload');
    assert.equal(verifyToken('not-a-token', 'client'), null);
    assert.equal(verifyToken(undefined, 'client'), null);
  });

  test('expired tokens are rejected', () => {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const expired = jwt.sign({ tenantUserId: 'u1', typ: 'client', exp: Math.floor(Date.now() / 1000) - 60 }, secret);
    assert.equal(verifyToken(expired, 'client'), null);
  });

  test('unknown token types cannot be minted', () => {
    assert.throws(() => signToken('superuser', {}), /Unknown token type/);
  });
});
