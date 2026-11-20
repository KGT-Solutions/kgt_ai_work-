const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Category-aware training guidance (services/botAuditor.js). The "Path to 100%"
// checklist must fit the tenant's businessCategory — a sweets shop should be
// asked for delivery timeframes and a return policy, not a SaaS pricing sheet —
// through the LLM prompt (primary) and a tailored fallback (model named none, or
// the keyword estimate). The LLM is a mock.

for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = '';
const llmClient = require('../../src/engine/llmClient');
mock.method(llmClient, 'isLlmConfigured', () => true);
let modelReply;
mock.method(llmClient, 'generateAnswer', async () => {
  if (modelReply instanceof Error) throw modelReply;
  return { text: modelReply, provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } };
});

const { auditKnowledge, buildAuditPrompt, PILLARS } = require('../../src/services/botAuditor');

const long = (s, n) => Array.from({ length: n }, (_, i) => `${s} ${i}.`).join(' ');
const RICH_DOCS = [
  { title: 'About', content: `## Who we are\n\n${long('We sell traditional sweets and snacks across our stores', 120)}`, category: 'CORE_OVERVIEW' },
  { title: 'Menu', content: `## Products\n\n${long('Our boxes come in several sizes and flavours', 100)}`, category: 'CORE_OVERVIEW' },
  { title: 'Help', content: `## Orders\n\n${long('For orders and delivery, reach our store team', 100)}`, category: 'FAQ' }
];
// All pillars weak so every bot's fallback produces one requirement per pillar;
// empty model requirements force the category fallback path.
const weakReply = (extra = {}) => JSON.stringify({
  pillars: Object.fromEntries(PILLARS.map((p) => [p.id, { score: 30, summary: `${p.id} summary`, gaps: [`${p.id} gap`] }])),
  criticalGaps: { support: ['A gap'], sales: ['A gap'] },
  requirements: { support: [], sales: [] },
  ...extra
});

beforeEach(() => { modelReply = weakReply(); });

describe('buildAuditPrompt: category steering', () => {
  test('a known category adds a business-specific rule naming what it should have', () => {
    const { systemPrompt } = buildAuditPrompt({
      company: { name: 'Bikanervala', industryLabel: 'Sweets', businessCategory: 'ecommerce' },
      digest: 'x', stats: { documents: 1, sections: 1, characters: 1 }
    });
    assert.match(systemPrompt, /This is a E-commerce \/ Retail business\./);
    assert.match(systemPrompt, /returns and shipping policies/); // the category's asksFor
  });

  test('healthcare steers differently', () => {
    const { systemPrompt } = buildAuditPrompt({
      company: { name: 'City Clinic', industryLabel: 'Clinic', businessCategory: 'healthcare' },
      digest: 'x', stats: { documents: 1, sections: 1, characters: 1 }
    });
    assert.match(systemPrompt, /This is a Healthcare business\./);
    assert.match(systemPrompt, /patient FAQs/);
  });

  test('no / other / unknown category adds no steering rule (uncategorised tenants unchanged)', () => {
    for (const businessCategory of [undefined, 'other', 'crypto-casino']) {
      const { systemPrompt } = buildAuditPrompt({
        company: { name: 'Acme', industryLabel: 'Business', businessCategory },
        digest: 'x', stats: { documents: 1, sections: 1, characters: 1 }
      });
      assert.doesNotMatch(systemPrompt, /This is a .+ business\. Make every/);
    }
  });
});

describe('auditKnowledge: category-tailored fallback requirements', () => {
  test('e-commerce gets retail-specific next steps, not generic pitch decks', async () => {
    const r = await auditKnowledge({ company: { name: 'Bikanervala', industryLabel: 'Sweets', businessCategory: 'ecommerce' }, documents: RICH_DOCS });
    const sales = r.bots.sales.requirements.join(' | ');
    const support = r.bots.support.requirements.join(' | ');
    assert.match(support, /returns, refund and exchange policy/);
    assert.match(sales, /delivery and shipping charges/); // pricing pillar, retail-worded
    assert.doesNotMatch(sales, /pitch deck|SaaS|API documentation/i);
  });

  test('healthcare gets clinic-specific next steps', async () => {
    const r = await auditKnowledge({ company: { name: 'City Clinic', industryLabel: 'Clinic', businessCategory: 'healthcare' }, documents: RICH_DOCS });
    const all = [...r.bots.support.requirements, ...r.bots.sales.requirements].join(' | ');
    assert.match(all, /consultation fees|insurances you accept/);
    assert.match(all, /appointment booking steps/);
  });

  test('an uncategorised tenant keeps the generic phrasing', async () => {
    const r = await auditKnowledge({ company: { name: 'Acme', industryLabel: 'Business' }, documents: RICH_DOCS });
    assert.match(r.bots.sales.requirements.join(' | '), /Add content covering /);
  });

  test('when the model DOES name requirements, those win over the fallback', async () => {
    modelReply = weakReply({ requirements: { support: ['Upload your allergen chart'], sales: ['Add your festive gift catalog'] } });
    const r = await auditKnowledge({ company: { name: 'Bikanervala', industryLabel: 'Sweets', businessCategory: 'ecommerce' }, documents: RICH_DOCS });
    assert.deepEqual(r.bots.support.requirements, ['Upload your allergen chart']);
    assert.deepEqual(r.bots.sales.requirements, ['Add your festive gift catalog']);
  });

  test('the heuristic estimate (no model) is also category-tailored', async () => {
    modelReply = new Error('upstream down');
    const warn = mock.method(console, 'warn', () => {});
    try {
      const r = await auditKnowledge({ company: { name: 'Bikanervala', industryLabel: 'Sweets', businessCategory: 'ecommerce' }, documents: [{ title: 'Home', content: 'Welcome.' }] });
      assert.equal(r.method, 'heuristic');
      const all = [...r.bots.support.requirements, ...r.bots.sales.requirements].join(' | ');
      assert.ok(/product catalog with variants|returns, refund and exchange|delivery and shipping/.test(all), all);
    } finally {
      warn.mock.restore();
    }
  });
});
