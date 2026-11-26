// Guardrails enforcement and image persistence as a chat turn actually runs
// them, through runTenantChat. Collaborators are stubbed BEFORE tenantChat is
// required (it destructures them at load), so nothing reaches a provider or a
// real database — see imageGuardrailChat.test.js for the same load-order note.

const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const chatEngine = require('../../src/engine/chatEngine');
const catalogIngest = require('../../src/services/catalogIngest');
const leads = require('../../src/services/leads');
const chatSessions = require('../../src/services/chatSessions');
const teamAlerts = require('../../src/services/teamAlerts');
const llm = require('../../src/engine/llmClient');

let engineCalls;
chatEngine.getEngineAnswer = async ({ query }) => { engineCalls.push(query); return { answer: 'Engine answer.', confidence: 0.9, answered: true, offTopic: false }; };
catalogIngest.matchCatalogProducts = async () => [];
leads.trackLeadActivity = async () => {};
chatSessions.recordTurn = async () => {};
teamAlerts.notifyIfNeedsAttention = () => {};

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const { runTenantChat } = require('../../src/services/tenantChat');

let sharpPresent = true;
try { require('sharp'); } catch { sharpPresent = false; }

const TENANT = { id: 't-enf', slug: 'acme', name: 'Acme', active: true };
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const relevant = { visionClassify: async () => JSON.stringify({ relevant: true, product_name: 'Thing', text: 'a thing' }) };

let messages, sessionUpdates, upserts, sessionRow, imageCount;

beforeEach(() => {
  resetStore();
  messages = []; sessionUpdates = []; upserts = []; imageCount = 0; engineCalls = [];
  sessionRow = null; // set per test for the findFirst path
  process.env.IMAGE_PIPELINE_CV = 'false';
  llm.isLlmConfigured = () => false; // spam check fails open unless a test turns it on

  prisma.chatSession = {
    findFirst: async () => sessionRow,
    create: async () => ({ id: 'sess-new', tenantId: TENANT.id, messageCount: 0, pausedAt: null, pauseReason: null }),
    update: async ({ where, data }) => { sessionUpdates.push({ where, data }); Object.assign(sessionRow, data); return { ...sessionRow }; }
  };
  prisma.chatMessage = {
    findMany: async () => [],
    createMany: async ({ data }) => { messages.push(...data); return { count: data.length }; },
    count: async () => imageCount
  };
  prisma.chatImageAsset = { upsert: async (args) => { upserts.push(args); return {}; } };
  prisma.tenantFaq = { findUnique: async () => null };
});
afterEach(() => { delete process.env.IMAGE_PIPELINE_CV; });

const guards = (over = {}) => ({ maxMessages: null, windowSeconds: null, limitMessage: null, spamCheckEnabled: false, blockedCountries: [], imagesEnabled: true, ...over });
const userMsg = () => messages.find((m) => m.role === 'user');
const existing = (over = {}) => ({ id: 'sess-1', tenantId: TENANT.id, messageCount: 0, pausedAt: null, pauseReason: null, botType: 'support', ...over });

describe('spam auto-pause', () => {
  // messageCount counts both roles (2/turn), so visitor message N has messageCount 2*(N-1).
  const countFor = (visitorNo) => 2 * (visitorNo - 1);

  for (const n of [2, 4, 8, 16]) {
    test(`a SPAM verdict at visitor message #${n} pauses the conversation and blocks the reply`, async () => {
      llm.isLlmConfigured = () => true;
      llm.generateAnswer = async () => ({ text: 'SPAM' });
      sessionRow = existing({ messageCount: countFor(n) });
      const res = await runTenantChat({ tenant: TENANT, body: { query: 'spam spam', sessionId: 'sess-1' }, guardrails: guards({ spamCheckEnabled: true }) });
      assert.equal(res.paused, true);
      assert.equal(res.pauseReason, 'spam');
      assert.deepEqual(engineCalls, [], 'a paused turn never reaches the engine');
      const pausedUpdate = sessionUpdates.find((u) => u.data.pauseReason === 'spam');
      assert.ok(pausedUpdate && pausedUpdate.data.pausedAt, 'pausedAt + reason are persisted');
    });
  }

  test('a non-checkpoint visitor message is not spam-checked (so a SPAM model is never even asked)', async () => {
    let asked = 0;
    llm.isLlmConfigured = () => true;
    llm.generateAnswer = async () => { asked += 1; return { text: 'SPAM' }; };
    sessionRow = existing({ messageCount: countFor(3) }); // visitor #3
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'hello', sessionId: 'sess-1' }, guardrails: guards({ spamCheckEnabled: true }) });
    assert.equal(asked, 0);
    assert.equal(res.answer, 'Engine answer.');
    assert.equal(engineCalls.length, 1);
  });

  test('an OK verdict at a checkpoint does not pause', async () => {
    llm.isLlmConfigured = () => true;
    llm.generateAnswer = async () => ({ text: 'OK' });
    sessionRow = existing({ messageCount: countFor(2) });
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'genuine question', sessionId: 'sess-1' }, guardrails: guards({ spamCheckEnabled: true }) });
    assert.equal(res.answer, 'Engine answer.');
    assert.equal(res.paused, undefined);
    assert.equal(sessionUpdates.some((u) => u.data.pauseReason === 'spam'), false);
  });

  test('spamCheckEnabled off skips the check entirely', async () => {
    let asked = 0;
    llm.isLlmConfigured = () => true;
    llm.generateAnswer = async () => { asked += 1; return { text: 'SPAM' }; };
    sessionRow = existing({ messageCount: countFor(2) });
    await runTenantChat({ tenant: TENANT, body: { query: 'hi', sessionId: 'sess-1' }, guardrails: guards({ spamCheckEnabled: false }) });
    assert.equal(asked, 0);
    assert.equal(engineCalls.length, 1);
  });

  test('fails open: at a checkpoint with no LLM configured, the turn is answered normally', async () => {
    llm.isLlmConfigured = () => false;
    sessionRow = existing({ messageCount: countFor(4) });
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'hi', sessionId: 'sess-1' }, guardrails: guards({ spamCheckEnabled: true }) });
    assert.equal(res.answer, 'Engine answer.');
  });
});

describe('a paused session blocks bot replies', () => {
  test('an already-paused conversation is answered with the paused notice, not the engine', async () => {
    sessionRow = existing({ pausedAt: new Date(), pauseReason: 'manual', messageCount: 10 });
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'still there?', sessionId: 'sess-1' }, guardrails: guards() });
    assert.equal(res.paused, true);
    assert.equal(res.pauseReason, 'manual');
    assert.deepEqual(engineCalls, []);
    assert.equal(userMsg().content, 'still there?', 'the visitor message is still recorded for review');
  });

  test('the dashboard test chat (sandbox) is never paused or spam-checked', async () => {
    llm.isLlmConfigured = () => true;
    llm.generateAnswer = async () => ({ text: 'SPAM' });
    const res = await runTenantChat({ tenant: TENANT, body: { query: 'hi', sessionId: 'sess-1' }, sandbox: true, guardrails: guards({ spamCheckEnabled: true }) });
    assert.equal(res.answer, 'Engine answer.');
    assert.equal(messages.length, 0, 'sandbox persists nothing');
  });
});

describe('imagesEnabled enforcement', () => {
  test('with images off, an attached photo is ignored and the text is answered', async () => {
    sessionRow = existing();
    const res = await runTenantChat({
      tenant: TENANT, body: { query: 'what are your hours?', image: PNG_1X1, sessionId: 'sess-1' },
      guardrails: guards({ imagesEnabled: false }), imageDeps: relevant
    });
    assert.equal(res.answer, 'Engine answer.');
    assert.deepEqual(engineCalls, ['what are your hours?'], 'no photo context was added');
    assert.deepEqual(userMsg().imageKeys, [], 'nothing stored');
    assert.deepEqual(upserts, []);
  });

  test('with images off, a photo-only turn is politely declined', async () => {
    sessionRow = existing();
    const res = await runTenantChat({
      tenant: TENANT, body: { image: PNG_1X1, sessionId: 'sess-1' },
      guardrails: guards({ imagesEnabled: false }), imageDeps: relevant
    });
    assert.match(res.answer, /image uploads aren.t available|तस्वीरें नहीं/i);
    assert.deepEqual(engineCalls, []);
  });
});

describe('image persistence', { skip: !sharpPresent && 'sharp not installed' }, () => {
  // The 1x1 fixture passes the guardrail (CV decode is off) but is too minimal
  // for sharp to re-encode; persistence genuinely decodes, so use a real image.
  let VALID_IMG;
  before(async () => {
    const sharp = require('sharp');
    const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
    VALID_IMG = `data:image/png;base64,${buf.toString('base64')}`;
  });

  test('a photo that clears the guardrail is stored (EXIF-stripped) and keyed onto the turn', async () => {
    sessionRow = existing();
    const res = await runTenantChat({
      tenant: TENANT, body: { query: 'is this sealed?', image: VALID_IMG, sessionId: 'sess-1' },
      guardrails: guards(), imageDeps: relevant
    });
    assert.equal(res.answer, 'Engine answer.');
    assert.equal(upserts.length, 1, 'the image was persisted once');
    assert.match(upserts[0].where.tenantId_key.key, /^[0-9a-f]{32}$/);
    assert.equal(userMsg().imageKeys.length, 1, 'the key is attached to the visitor message');
    assert.equal(userMsg().imageKeys[0], upserts[0].where.tenantId_key.key);
  });

  test('the per-chat cap (3) stops a 4th image being stored, but the turn is still answered', async () => {
    imageCount = 3; // already at the cap
    sessionRow = existing();
    const res = await runTenantChat({
      tenant: TENANT, body: { query: 'another one', image: VALID_IMG, sessionId: 'sess-1' },
      guardrails: guards(), imageDeps: relevant
    });
    assert.equal(res.answer, 'Engine answer.');
    assert.deepEqual(upserts, [], 'no 4th image stored');
    assert.deepEqual(userMsg().imageKeys, []);
  });

  test('sandbox isolation: the dashboard test chat persists no image and no messages', async () => {
    const res = await runTenantChat({
      tenant: TENANT, body: { query: 'test', image: VALID_IMG }, sandbox: true,
      guardrails: guards(), imageDeps: relevant
    });
    assert.equal(res.answer, 'Engine answer.');
    assert.deepEqual(upserts, [], 'no image stored in sandbox');
    assert.equal(messages.length, 0, 'no transcript rows in sandbox');
  });
});
