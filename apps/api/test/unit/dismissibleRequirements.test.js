const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Enriched, dismissible "Path to 100%" items (services/botAuditor.js):
//   - EVERY displayed requirement (model-authored or category fallback) carries
//     description / importance / botUtility, mapped to a pillar, keyed per item;
//   - recomputeReadiness() removes a dismissed item's share of its pillar's
//     shortfall from the score's maximum, so the % rises — no second LLM call.
// The LLM is a mock.

for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = '';
const llmClient = require('../../src/engine/llmClient');
mock.method(llmClient, 'isLlmConfigured', () => true);
let modelReply;
mock.method(llmClient, 'generateAnswer', async () => {
  if (modelReply instanceof Error) throw modelReply;
  return { text: modelReply, provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } };
});

const { auditKnowledge, recomputeReadiness, PILLARS } = require('../../src/services/botAuditor');

const long = (s, n) => Array.from({ length: n }, (_, i) => `${s} ${i}.`).join(' ');
const RICH_DOCS = [
  { title: 'About', content: `## Who we are\n\n${long('We sell traditional sweets across our stores', 120)}`, category: 'CORE_OVERVIEW' },
  { title: 'Pricing', content: `## Plans\n\n${long('A gift box is priced from 499 and ships in two days', 100)}`, category: 'CUSTOM_POLICY' },
  { title: 'Help', content: `## Orders\n\n${long('For orders and returns reach our store team', 100)}`, category: 'FAQ' }
];
const reply = (scores, requirements) => JSON.stringify({
  pillars: Object.fromEntries(PILLARS.map((p) => [p.id, { score: scores[p.id], summary: `${p.id} summary`, gaps: [`${p.id} gap`] }])),
  criticalGaps: { support: ['A gap'], sales: ['A gap'] },
  requirements
});

beforeEach(() => {
  modelReply = reply({ identity: 90, features: 80, pricing: 60, support: 60, sales: 60 }, {
    support: ['Add a detailed return/refund policy document', 'Include specific SLAs and support hours'],
    sales: ['Provide competitive analysis documents', 'Include verified customer testimonials or case studies']
  });
});

describe('requirementItems: every shown requirement is enriched', () => {
  test('model-authored asks keep their wording, are classified to a pillar, and carry the explanation fields', async () => {
    const r = await auditKnowledge({ company: { name: 'Acme', industryLabel: 'Shop' }, documents: RICH_DOCS });
    const support = r.bots.support.requirementItems;
    assert.equal(support.length, 2);
    assert.deepEqual(support.map((i) => i.key), ['support:0', 'support:1'], 'keyed per item so each is dismissible');
    assert.deepEqual(support.map((i) => i.pillar), ['support', 'support'], 'return policy + SLAs → support pillar');
    assert.equal(support[0].text, 'Add a detailed return/refund policy document', 'the model\'s specific wording is preserved');
    for (const it of support) assert.ok(it.text && it.description && it.importance && it.botUtility, 'all explanation fields present');
    assert.equal(r.bots.sales.requirementItems[0].pillar, 'sales', 'competitive analysis → sales pillar');
    assert.ok(Number.isFinite(r.bots.support.cap), 'cap exposed for recompute');
    // Back-compat: legacy string list unchanged and parallel to the items.
    assert.deepEqual(r.bots.support.requirements, support.map((i) => i.text));
  });

  test('with no model asks, items fall back to one per genuine gap pillar (< 50), category-tailored', async () => {
    modelReply = reply({ identity: 90, features: 80, pricing: 30, support: 40, sales: 20 }, { support: [], sales: [] });
    const r = await auditKnowledge({ company: { name: 'Acme', industryLabel: 'Shop' }, documents: RICH_DOCS });
    const support = r.bots.support.requirementItems;
    assert.deepEqual(support.map((i) => i.pillar), ['pricing', 'support'], 'the two in-scope pillars below 50');
    assert.ok(support.every((i) => i.description && i.importance && i.botUtility));
  });

  test('importance is category-specific where we have copy, generic otherwise', async () => {
    modelReply = reply({ identity: 90, features: 80, pricing: 30, support: 40, sales: 20 }, { support: [], sales: [] });
    const retail = await auditKnowledge({ company: { name: 'Bikanervala', industryLabel: 'Sweets', businessCategory: 'ecommerce' }, documents: RICH_DOCS });
    const plain = await auditKnowledge({ company: { name: 'Acme', industryLabel: 'Shop' }, documents: RICH_DOCS });
    const impFor = (r, pillar) => r.bots.support.requirementItems.find((i) => i.pillar === pillar).importance;
    assert.match(impFor(retail, 'support'), /[Rr]eturns, refunds/);
    assert.notEqual(impFor(retail, 'support'), impFor(plain, 'support'));
  });
});

describe('recomputeReadiness: dismissing excludes an item from the score maximum', () => {
  const report = (items) => ({
    readinessScore: 56, readinessLevel: 'Moderate',
    bots: {
      sales: {
        score: 56, level: 'Moderate', cap: 100,
        pillars: [
          { id: 'identity', weight: 15, score: 80 }, { id: 'features', weight: 25, score: 80 },
          { id: 'pricing', weight: 30, score: 80 }, { id: 'sales', weight: 30, score: 0 }
        ],
        requirementItems: items
      }
    }
  });
  const salesItem = (i) => ({ key: `sales:${i}`, pillar: 'sales', text: `ask ${i}` });

  test('dismissing the only gap item for a pillar boosts the score (earned / adjusted-max × 100)', () => {
    const out = recomputeReadiness(report([salesItem(0)]), ['sales:0']);
    // earned 56; shortfall(sales)=100*30/100=30; adjustedMax=70; 56/70*100 = 80
    assert.equal(out.bots.sales.score, 80);
    assert.equal(out.bots.sales.level, 'Production Ready');
    assert.equal(out.readinessScore, 80);
    assert.deepEqual(out.ignoredRequirements, ['sales:0']);
  });

  test('two items share a pillar: dismissing one gives a partial boost, both gives the full boost', () => {
    const r = report([salesItem(0), salesItem(1)]);
    assert.equal(recomputeReadiness(r, ['sales:0']).bots.sales.score, 66);        // share 15 → max 85 → 56/85
    assert.equal(recomputeReadiness(r, ['sales:0', 'sales:1']).bots.sales.score, 80); // share 30 → max 70 → 56/70
  });

  test('the content cap still limits — you cannot dismiss past "too little content"', () => {
    const r = report([salesItem(0)]); r.bots.sales.cap = 25;
    assert.equal(recomputeReadiness(r, ['sales:0']).bots.sales.score, 25);
  });

  test('an unknown key is a no-op; the input is never mutated', () => {
    const r = report([salesItem(0)]);
    assert.equal(recomputeReadiness(r, ['sales:99']).bots.sales.score, 56);
    assert.equal(r.bots.sales.score, 56);
    assert.equal(r.ignoredRequirements, undefined);
  });
});
