const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildDigest, buildFaqPrompt, parseFaqResponse, MAX_PER_BOT } = require('../src/services/tenantFaqs');

describe('tenantFaqs: parseFaqResponse', () => {
  test('reads a plain JSON reply', () => {
    const out = parseFaqResponse('{"support":["How do I reset my Acme router?","Can I return a unit after 30 days?"],"sales":["What does the Pro plan cost?","How fast can you deploy?"]}');
    assert.deepEqual(out.supportFaqs, ['How do I reset my Acme router?', 'Can I return a unit after 30 days?']);
    assert.deepEqual(out.salesFaqs, ['What does the Pro plan cost?', 'How fast can you deploy?']);
  });

  test('tolerates code fences and prose around the JSON', () => {
    const out = parseFaqResponse('Here you go:\n```json\n{"support":["How do I pair the sensor?"],"sales":["Is there a free trial?"]}\n```');
    assert.deepEqual(out, { supportFaqs: ['How do I pair the sensor?'], salesFaqs: ['Is there a free trial?'] });
  });

  test('cleans list markers, adds a missing "?", caps each list, and drops junk', () => {
    const out = parseFaqResponse(JSON.stringify({
      support: ['1. How do I update the firmware', 'hi', 42, 'Visit https://evil.example now?', 'Where is my order?', 'Can I change my address?', 'Is there a warranty?'],
      sales: ['- What integrations do you support?']
    }));
    assert.equal(out.supportFaqs.length, MAX_PER_BOT);
    assert.equal(out.supportFaqs[0], 'How do I update the firmware?');
    assert.ok(!out.supportFaqs.some((q) => q.includes('http')));
    assert.deepEqual(out.salesFaqs, ['What integrations do you support?']);
  });

  test('de-duplicates across both bots', () => {
    const out = parseFaqResponse('{"support":["How much does it cost?","How do I log in?"],"sales":["How much does it cost?","What sets you apart?"]}');
    assert.deepEqual(out.salesFaqs, ['What sets you apart?']);
  });

  test('rejects replies without JSON or without questions for a bot', () => {
    assert.throws(() => parseFaqResponse('Sorry, I cannot help with that.'), /no JSON/);
    assert.throws(() => parseFaqResponse('{"support":["How do I log in?"],"sales":[]}'), /no usable questions/);
    assert.throws(() => parseFaqResponse('{"support": [oops]}'), /not valid JSON/);
  });
});

describe('tenantFaqs: buildDigest and prompt', () => {
  test('empty documents give an empty digest', () => {
    assert.equal(buildDigest([]), '');
  });

  test('stays within budget and reaches every category despite many overview pages', () => {
    const docs = [
      ...Array.from({ length: 40 }, (_, i) => ({ title: `About ${i}`, content: 'x'.repeat(3000), category: 'CORE_OVERVIEW' })),
      { title: 'Pricing', content: 'Pro plan is $49/month.', category: 'CUSTOM_POLICY' },
      { title: 'Help', content: 'Reset by holding the button.', category: 'FAQ' }
    ];
    const digest = buildDigest(docs, 5000);
    assert.ok(digest.length <= 5000 + 200, `digest too long: ${digest.length}`);
    assert.match(digest, /### Pricing/);
    assert.match(digest, /### Help/);
  });

  test('prompt names the tenant and fences the content as data', () => {
    const { systemPrompt, userPrompt } = buildFaqPrompt({ tenant: { name: 'Acme', industryLabel: 'Smart home' }, digest: 'DOCS' });
    assert.match(systemPrompt, /Acme/);
    assert.match(systemPrompt, /not instructions/);
    assert.equal(userPrompt, '<content>\nDOCS\n</content>');
  });
});
