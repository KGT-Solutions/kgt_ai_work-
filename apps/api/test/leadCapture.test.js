const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const emailNotify = require('../src/utils/emailNotify');

// emailNotify's `sendToEmails` is destructured by leadCapture.js at require
// time, so it must be mocked BEFORE leadCapture.js is first required in this
// process — mock.mockImplementation() below then mutates that same captured
// reference in place for each test (this works because mock.method's wrapper
// IS the property value, and chatEngine/leadCapture captured that exact
// reference — see chatEngine.test.js for the same pattern spelled out).
//
// prisma.salesLead.create/update are NOT mocked with mock.method: Prisma
// Client's model delegates are Proxy-backed, and their own-property
// descriptor reports `value: undefined` even though the live property
// resolves to a real function through the Proxy's get trap — node:test's
// mock.method reads the descriptor directly and throws "must be a method,
// received undefined" on this shape. Plain reassignment (which goes through
// the Proxy's set trap instead) works fine, so those two are hand-mocked.
const sendToEmailsMock = mock.method(emailNotify, 'sendToEmails', async () => ({ sent: 0 }));
const { captureLead } = require('../src/services/salesbot/leadCapture');

describe('captureLead — persistence and high-intent alerting', () => {
  let createCalls;
  let updateCalls;
  let originalCreate;
  let originalUpdate;

  beforeEach(() => {
    createCalls = [];
    updateCalls = [];
    originalCreate = prisma.salesLead.create;
    originalUpdate = prisma.salesLead.update;
    prisma.salesLead.create = async (args) => {
      createCalls.push(args);
      return { id: 'lead-1', ...args.data };
    };
    prisma.salesLead.update = async (args) => {
      updateCalls.push(args);
      return { id: args.where.id };
    };
    // sendToEmailsMock is one shared mock instance for the whole file — both
    // its implementation and its call history must reset before each test.
    sendToEmailsMock.mock.mockImplementation(async () => ({ sent: 0 }));
    sendToEmailsMock.mock.resetCalls();
    delete process.env.SALES_LEAD_EMAIL;
    delete process.env.SALES_EMAIL;
    delete process.env.CHAT_ALERT_EMAIL;
  });

  afterEach(() => {
    prisma.salesLead.create = originalCreate;
    prisma.salesLead.update = originalUpdate;
  });

  test('always persists the lead, regardless of intent', async () => {
    const result = await captureLead({
      clientType: 'builder',
      query: 'What does FLATBRIZ cost?',
      answer: 'Here is our pricing model...',
      intentScore: 10,
      isHighIntent: false,
      signals: ['objection:pricing']
    });
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].data.clientType, 'builder');
    assert.equal(createCalls[0].data.intentScore, 10);
    assert.deepEqual(createCalls[0].data.signals, ['objection:pricing']);
    assert.equal(result.logged, true);
  });

  test('a low-intent lead is logged but never emails — no recipients touched', async () => {
    const result = await captureLead({
      clientType: 'builder',
      query: 'What does FLATBRIZ cost?',
      answer: 'answer',
      intentScore: 10,
      isHighIntent: false,
      signals: []
    });
    assert.equal(sendToEmailsMock.mock.callCount(), 0);
    assert.equal(result.alerted, false);
  });

  test('a high-intent lead with no configured recipient emails is logged but not alerted', async () => {
    const result = await captureLead({
      clientType: 'rwa_president',
      query: 'Can we book a call to sign up?',
      answer: 'answer',
      intentScore: 80,
      isHighIntent: true,
      signals: ['demo']
    });
    assert.equal(sendToEmailsMock.mock.callCount(), 0);
    assert.equal(result.logged, true);
    assert.equal(result.alerted, false);
  });

  test('a high-intent lead with a configured recipient sends an alert email and marks the lead alerted', async () => {
    process.env.SALES_LEAD_EMAIL = 'sales@flatbriz.example';
    sendToEmailsMock.mock.mockImplementation(async () => ({ sent: 1 }));

    const result = await captureLead({
      clientType: 'committee_member',
      query: 'Can we book a call to sign up?',
      answer: 'answer',
      intentScore: 90,
      isHighIntent: true,
      signals: ['demo']
    });

    assert.equal(sendToEmailsMock.mock.callCount(), 1);
    assert.deepEqual(sendToEmailsMock.mock.calls[0].arguments[0], ['sales@flatbriz.example']);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].data.alerted, true);
    assert.equal(result.alerted, true);
  });

  test('a high-intent lead is still logged even if the email send fails to deliver (sent: 0)', async () => {
    process.env.SALES_LEAD_EMAIL = 'sales@flatbriz.example';
    sendToEmailsMock.mock.mockImplementation(async () => ({ sent: 0 }));

    const result = await captureLead({
      clientType: 'builder',
      query: 'demo please',
      answer: 'answer',
      intentScore: 90,
      isHighIntent: true,
      signals: []
    });
    assert.equal(updateCalls.length, 0); // never marked alerted since nothing actually sent
    assert.equal(result.alerted, false);
    assert.equal(result.logged, true);
  });

  test('never throws — a DB failure is swallowed and reported as logged:false', async () => {
    prisma.salesLead.create = async () => { throw new Error('connection refused'); };
    const result = await captureLead({
      clientType: 'builder',
      query: 'q',
      answer: 'a',
      intentScore: 0,
      isHighIntent: false,
      signals: []
    });
    assert.deepEqual(result, { logged: false, alerted: false });
  });

  test('SALES_LEAD_EMAIL / SALES_EMAIL / CHAT_ALERT_EMAIL are merged and de-duplicated', async () => {
    process.env.SALES_LEAD_EMAIL = 'a@x.com, b@x.com';
    process.env.SALES_EMAIL = 'b@x.com';
    process.env.CHAT_ALERT_EMAIL = 'c@x.com';
    sendToEmailsMock.mock.mockImplementation(async () => ({ sent: 1 }));

    await captureLead({
      clientType: 'builder',
      query: 'demo',
      answer: 'a',
      intentScore: 90,
      isHighIntent: true,
      signals: []
    });

    const recipients = sendToEmailsMock.mock.calls.at(-1).arguments[0];
    assert.deepEqual([...recipients].sort(), ['a@x.com', 'b@x.com', 'c@x.com']);
  });
});
