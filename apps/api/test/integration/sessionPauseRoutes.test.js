const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// PATCH /sessions/:id/pause and /resume on the workspace router, mounted with
// the tenant supplied by the auth middleware exactly as in production. Prisma is
// an in-memory store of one session.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const prisma = require('../../src/lib/prisma');
const workspace = require('../../src/routes/tenantWorkspace.routes');

let sessions, server, base;

before(async () => {
  prisma.chatSession.findFirst = async ({ where }) =>
    sessions.find((s) => s.id === where.id && s.tenantId === where.tenantId) || null;
  prisma.chatSession.update = async ({ where, data, select }) => {
    const s = sessions.find((x) => x.id === where.id);
    Object.assign(s, data);
    return select ? Object.fromEntries(Object.keys(select).map((k) => [k, s[k]])) : s;
  };
  prisma.chatMessage.findMany = async () => [
    { id: 'm1', role: 'user', content: '(image attached)', botType: 'support', confidence: null, answered: false, imageKeys: ['a1b2c3'], createdAt: new Date() },
    { id: 'm2', role: 'assistant', content: 'Thanks!', botType: 'support', confidence: 0.9, answered: true, imageKeys: [], createdAt: new Date() }
  ];
  prisma.lead.findMany = async () => [];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenant = { id: 't1' }; req.actor = 'client'; next(); }, workspace);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  sessions = [{ id: 'sess-1', tenantId: 't1', messageCount: 4, pausedAt: null, pauseReason: null, botType: 'support' }];
});

const patch = (id, action) => fetch(`${base}/sessions/${id}/${action}`, { method: 'PATCH' });
const json = async (res) => ({ status: res.status, body: await res.json() });

describe('PATCH /sessions/:id/pause', () => {
  test('pauses the conversation with reason "manual" and returns the pause state', async () => {
    const { status, body } = await json(await patch('sess-1', 'pause'));
    assert.equal(status, 200);
    assert.ok(body.pausedAt, 'pausedAt is set');
    assert.equal(body.pauseReason, 'manual');
    assert.equal(sessions[0].pauseReason, 'manual');
  });

  test('404 for a session that is not this tenant\'s', async () => {
    assert.equal((await patch('sess-other', 'pause')).status, 404);
  });
});

describe('PATCH /sessions/:id/resume', () => {
  test('clears the pause', async () => {
    sessions[0].pausedAt = new Date();
    sessions[0].pauseReason = 'spam';
    const { status, body } = await json(await patch('sess-1', 'resume'));
    assert.equal(status, 200);
    assert.equal(body.pausedAt, null);
    assert.equal(body.pauseReason, null);
    assert.equal(sessions[0].pausedAt, null);
  });

  test('404 for an unknown session', async () => {
    assert.equal((await patch('nope', 'resume')).status, 404);
  });
});

describe('GET /sessions/:id exposes image data for the transcript', () => {
  test('returns tenantId and each message\'s imageKeys so the dashboard can render them', async () => {
    const { status, body } = await json(await fetch(`${base}/sessions/sess-1`));
    assert.equal(status, 200);
    assert.equal(body.tenantId, 't1', 'the client builds scoped image URLs from this');
    assert.deepEqual(body.messages.find((m) => m.id === 'm1').imageKeys, ['a1b2c3']);
    assert.deepEqual(body.messages.find((m) => m.id === 'm2').imageKeys, []);
    // pause state is exposed too, for the badge/controls
    assert.ok('pausedAt' in body && 'pauseReason' in body);
  });
});
