const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildUserPrompt } = require('../src/engine/promptBuilder');
const { createTenantSupportProfile, createTenantSalesProfile, SALES_SENTINEL } = require('../src/domains/tenantProfile');

const TENANT = { id: 't1', slug: 'acme', name: 'Acme', industryLabel: 'Retail', minConfidence: 0.3, outOfScopeMessage: 'n/a' };
const ranked = [{ chunk: { title: 'Pricing', content: 'Plans start at $10.', category: 'CUSTOM_POLICY' } }];

describe('buildUserPrompt — replyReminder', () => {
  test('the sales reminder follows the prospect message, asking for a closing question', () => {
    const prompt = buildUserPrompt(createTenantSalesProfile(TENANT), 'How much is it?', ranked);
    const question = prompt.indexOf('How much is it?');
    const reminder = prompt.indexOf('REPLY FORMAT:');
    assert.ok(question !== -1 && reminder > question, 'reminder comes after the question');
    assert.match(prompt, /then one short, friendly question/);
    assert.match(prompt, /Ask for their email only if/);
    assert.ok(prompt.includes(SALES_SENTINEL), 'the reminder keeps the sentinel escape hatch');
  });

  test('normalizeChatText: markdown the model slips in never reaches the chat', () => {
    const { normalizeChatText } = require('../src/engine/promptBuilder');
    assert.equal(
      normalizeChatText('## Plans\nWe offer **two** plans:\n- Starter\n* Pro, with `API` access\n\n\n\nWant a walkthrough?'),
      'Plans\nWe offer two plans:\n• Starter\n• Pro, with API access\n\nWant a walkthrough?'
    );
    // Left alone: numbered steps, "•" bullets, in-word hyphens, arithmetic.
    const clean = '1. Open Settings\n2. Tap Billing\n• Takes 2-3 minutes\nTotal: 5 * 3 = 15';
    assert.equal(normalizeChatText(clean), clean);
  });

  test('support prompts carry no sales reminder', () => {
    const prompt = buildUserPrompt(createTenantSupportProfile(TENANT), 'How much is it?', ranked);
    assert.doesNotMatch(prompt, /REPLY FORMAT:/);
  });
});
