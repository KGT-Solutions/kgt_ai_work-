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
    assert.match(prompt, /finish with one short, friendly question/);
    assert.ok(prompt.includes(SALES_SENTINEL), 'the reminder keeps the sentinel escape hatch');
  });

  test('support prompts carry no sales reminder', () => {
    const prompt = buildUserPrompt(createTenantSupportProfile(TENANT), 'How much is it?', ranked);
    assert.doesNotMatch(prompt, /REPLY FORMAT:/);
  });
});
