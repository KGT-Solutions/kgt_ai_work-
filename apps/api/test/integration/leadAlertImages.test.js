const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Visitor images show up in the internal lead-alert email. The mailer is
// stubbed BEFORE teamAlerts is required (teamAlerts destructures sendMail at
// load), so the email is captured instead of sent.
const mailer = require('../../src/services/mailer');
let sent;
mailer.sendMail = async (msg) => { sent.push(msg); return { sent: true, via: 'test' }; };

const prisma = require('../../src/lib/prisma');
const { resetStore } = require('../../src/lib/sharedStore');
const { notifyLeadCaptured, resetAlertThrottle } = require('../../src/services/teamAlerts');

const TENANT = { id: 't-alert', slug: 'acme', name: 'Acme', teamEmail: 'team@acme.test' };
const LEAD = { id: 'l1', botType: 'support', email: 'ana@x.com', sessionId: 'sess-1' };
const KEY = 'f'.repeat(32);

let origFindMany;
beforeEach(async () => {
  sent = [];
  resetStore();
  await resetAlertThrottle();
  // Per-email toggle lookup (Feature 10): keep this test hermetic — default to
  // "enabled" without touching a real database.
  prisma.tenantEmailSettings = { findUnique: async () => null };
  origFindMany = prisma.chatMessage.findMany;
  prisma.chatMessage.findMany = async () => [
    { role: 'user', content: '(image attached)', imageKeys: [KEY] },
    { role: 'assistant', content: 'Thanks for the photo!', imageKeys: [] }
  ];
});
afterEach(() => {
  prisma.chatMessage.findMany = origFindMany;
  delete process.env.PUBLIC_API_URL;
});

describe('lead alert includes visitor images', () => {
  test('with a public base configured, the email links each attached image', async () => {
    process.env.PUBLIC_API_URL = 'https://api.test';
    const res = await notifyLeadCaptured({ tenant: TENANT, lead: LEAD });
    assert.equal(res.sent, true);
    assert.equal(sent.length, 1);
    const url = `https://api.test/api/v1/public/chat-images/${TENANT.id}/${KEY}.jpg`;
    assert.ok(sent[0].text.includes(url), 'the plain-text alert links the image');
    assert.ok(sent[0].html.includes(url), 'the HTML alert links/embeds the image');
  });

  test('without a public base, the email notes the attachment in words instead of a broken link', async () => {
    const res = await notifyLeadCaptured({ tenant: TENANT, lead: LEAD });
    assert.equal(res.sent, true);
    assert.doesNotMatch(sent[0].text, /https?:\/\/[^\s]*chat-images/, 'no absolute image link without a base');
    assert.match(sent[0].text, /image\(s\) attached/i, 'but the attachment is still noted');
  });
});
