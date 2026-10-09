const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Pre-flight readiness audit (services/botAuditor.js) and the Sales /
// Support classifier (services/shared/botScope.js). The LLM is a mock.

// No provider key, so even a missed mock can never reach a real LLM.
for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = '';
const llmClient = require('../src/engine/llmClient');
mock.method(llmClient, 'isLlmConfigured', () => true);
let modelReply;
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async () => {
  if (modelReply instanceof Error) throw modelReply;
  return { text: modelReply, provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } };
});

const { classifyChunk, parseBotScope, scopeCounts, botCanUse } = require('../src/services/shared/botScope');
const {
  auditKnowledge, parseAuditResponse, contentHash, levelFor, rememberWizardAudit, takeWizardAudit, PILLARS
} = require('../src/services/botAuditor');

const COMPANY = { name: 'Acme', industryLabel: 'Smart home devices' };
const pillarsJson = (scores, extra = {}) => JSON.stringify({
  pillars: Object.fromEntries(PILLARS.map((p) => [p.id, { score: scores[p.id], summary: `${p.id} summary`, gaps: [`${p.id} gap`] }])),
  criticalGaps: ['No support hours', 'No price for the Pro plan'],
  recommendations: ['Upload your price list', 'Add a troubleshooting FAQ'],
  ...extra
});
const long = (s, n) => Array.from({ length: n }, (_, i) => `${s} ${i}.`).join(' ');
// Enough text (>6000 chars) that the content caps don't apply, split across both bots.
const RICH_DOCS = [
  { title: 'About Acme', content: `## Who we are\n\n${long('Acme builds smart thermostats for homes', 60)}`, category: 'CORE_OVERVIEW' },
  { title: 'Pricing', content: `## Plans\n\n${long('The Pro plan costs ₹999 per month with remote control', 50)}`, category: 'CUSTOM_POLICY' },
  { title: 'Help', content: `## Troubleshooting\n\n${long('If it is not working, reset the device and set it up again', 50)}`, category: 'FAQ' }
];

beforeEach(() => {
  modelReply = pillarsJson({ identity: 90, features: 80, pricing: 70, support: 60, sales: 50 });
  generateAnswerMock.mock.resetCalls();
});

describe('botScope classifier', () => {
  test('support, sales or both, by what the section is about', () => {
    assert.equal(classifyChunk({ title: 'Login problems', content: 'If you cannot log in, reset your password.' }), 'support');
    assert.equal(classifyChunk({ title: 'Refund policy', content: 'Returns are accepted within 30 days for a refund.' }), 'support');
    assert.equal(classifyChunk({ title: 'Pricing', content: 'Starter is $19 per month; Enterprise pricing on request.' }), 'sales');
    assert.equal(classifyChunk({ title: 'Why choose us', content: 'Compare us with the alternatives: case studies show the ROI.' }), 'sales');
    assert.equal(classifyChunk({ title: 'Our story', content: 'Founded in 2015 in Pune by two engineers.' }), 'both');
  });

  test('a weak or evenly split signal stays with both bots', () => {
    assert.equal(classifyChunk({ title: 'Plans and support hours', content: 'Our plans include support hours on weekdays.' }), 'both');
  });

  test('a document scope overrides the classifier; a bot: tag overrides both', () => {
    const pricing = { title: 'Pricing', content: 'Starter is $19 per month.' };
    assert.equal(classifyChunk(pricing, 'SUPPORT'), 'support');
    assert.equal(classifyChunk(pricing, 'BOTH'), 'both');
    assert.equal(classifyChunk(pricing, 'AUTO'), 'sales');
    assert.equal(classifyChunk({ ...pricing, tags: ['benefit:x', 'bot:both'] }, 'SUPPORT'), 'both');
  });

  test('parseBotScope accepts the four scopes case-insensitively and rejects anything else', () => {
    assert.deepEqual(parseBotScope('sales'), { ok: true, value: 'SALES' });
    assert.deepEqual(parseBotScope(undefined), { ok: true, value: 'AUTO' });
    assert.equal(parseBotScope('marketing').ok, false);
  });

  test('each bot uses its own scope plus both; counts add up', () => {
    assert.ok(botCanUse('support', 'support') && botCanUse('support', 'both') && !botCanUse('support', 'sales'));
    assert.ok(botCanUse('sales', 'sales') && botCanUse('sales', 'both') && !botCanUse('sales', 'support'));
    assert.deepEqual(scopeCounts([{ scope: 'support' }, { scope: 'sales' }, { scope: 'both' }, { scope: 'both' }]),
      { support: 1, sales: 1, both: 2, supportBot: 3, salesBot: 3, total: 4 });
  });
});

describe('auditKnowledge', () => {
  test('the overall score is the weighted pillar average, computed here — not taken from the model', async () => {
    modelReply = pillarsJson({ identity: 90, features: 80, pricing: 70, support: 60, sales: 50 }, { readinessScore: 100 });
    const r = await auditKnowledge({ company: COMPANY, documents: RICH_DOCS });
    // 90*.15 + 80*.20 + 70*.20 + 60*.25 + 50*.20 = 68.5 -> 69
    assert.equal(r.readinessScore, 69);
    assert.equal(r.readinessLevel, 'Moderate');
    assert.equal(r.method, 'llm');
    assert.deepEqual(r.pillarScores.map((p) => p.id), ['identity', 'features', 'pricing', 'support', 'sales']);
    assert.deepEqual(r.criticalGaps, ['No support hours', 'No price for the Pro plan']);
    assert.deepEqual(r.recommendations, ['Upload your price list', 'Add a troubleshooting FAQ']);
    assert.equal(generateAnswerMock.mock.calls[0].arguments[0].maxTokens, 2500);
    assert.match(generateAnswerMock.mock.calls[0].arguments[0].userPrompt, /<content>[\s\S]*Pro plan costs ₹999/);
  });

  test('levels: 80+ Production Ready, 50-79 Moderate, under 50 Not Ready', () => {
    assert.equal(levelFor(80), 'Production Ready');
    assert.equal(levelFor(79), 'Moderate');
    assert.equal(levelFor(50), 'Moderate');
    assert.equal(levelFor(49), 'Not Ready');
  });

  test('a model generous about very little content is capped, and says why', async () => {
    modelReply = pillarsJson({ identity: 100, features: 100, pricing: 100, support: 100, sales: 100 });
    const r = await auditKnowledge({ company: COMPANY, documents: [
      { title: 'Pricing', content: '## Plans\n\nPro is ₹999 per month.' },
      { title: 'Help', content: '## Not working\n\nReset the device and set it up again.' }
    ] });
    assert.equal(r.readinessScore, 25);
    assert.equal(r.readinessLevel, 'Not Ready');
    assert.match(r.criticalGaps[0], /characters of content/);
  });

  test('a bot left with no knowledge of its own is a critical gap', async () => {
    const r = await auditKnowledge({ company: COMPANY, documents: [RICH_DOCS[0], RICH_DOCS[2]] });
    assert.equal(r.distribution.salesBot, 1, 'only the "both" overview section');
    assert.ok(r.distribution.supportBot >= 2);
    const onlySupport = await auditKnowledge({ company: COMPANY, documents: [{ ...RICH_DOCS[2], botScope: 'SUPPORT' }] });
    assert.ok(onlySupport.criticalGaps.some((g) => /Sales Bot has no knowledge/.test(g)));
  });

  test('when the model fails, a keyword estimate stands in — never an error', async () => {
    modelReply = new Error('upstream down');
    const warn = mock.method(console, 'warn', () => {});
    try {
      const r = await auditKnowledge({ company: COMPANY, documents: RICH_DOCS });
      assert.equal(r.method, 'heuristic');
      assert.match(r.notice, /keyword-based estimate/);
      assert.ok(r.readinessScore >= 0 && r.readinessScore <= 100);
      assert.ok(r.pillarScores.every((p) => p.score <= 80), 'keywords alone never claim a perfect pillar');
    } finally {
      warn.mock.restore();
    }
  });

  test('no documents: score 0, no model call', async () => {
    const r = await auditKnowledge({ company: COMPANY, documents: [] });
    assert.equal(r.readinessScore, 0);
    assert.equal(r.method, 'empty');
    assert.equal(generateAnswerMock.mock.callCount(), 0);
    assert.match(r.criticalGaps[0], /No knowledge added yet/);
  });
});

describe('parseAuditResponse', () => {
  test('tolerates prose and code fences; clamps scores; strips markdown and duplicates', () => {
    const raw = 'Here you go:\n```json\n' + JSON.stringify({
      pillars: Object.fromEntries(PILLARS.map((p) => [p.id, { score: p.id === 'pricing' ? 140 : '55', summary: '**Good**', gaps: ['- Missing X', 'missing x'] }])),
      criticalGaps: ['1. No prices', 'No prices'], recommendations: []
    }) + '\n```';
    const parsed = parseAuditResponse(raw);
    assert.equal(parsed.pillars.pricing.score, 100);
    assert.equal(parsed.pillars.identity.score, 55);
    assert.equal(parsed.pillars.identity.summary, 'Good');
    assert.deepEqual(parsed.pillars.identity.gaps, ['Missing X']);
    assert.deepEqual(parsed.criticalGaps, ['No prices']);
  });

  test('a reply missing a pillar score is rejected (and the audit falls back)', () => {
    assert.throws(() => parseAuditResponse('{"pillars": {"identity": {"score": 50}}}'), /no score for pillar "features"/);
    assert.throws(() => parseAuditResponse('no json here'), /no JSON object/);
  });
});

describe('content hash and the wizard hand-off', () => {
  test('the same pages in any order hash the same; any edit changes it', () => {
    const a = [{ title: 'A', content: 'one' }, { title: 'B', content: 'two', category: 'FAQ' }];
    assert.equal(contentHash(a), contentHash([...a].reverse()));
    assert.notEqual(contentHash(a), contentHash([{ ...a[0], content: 'one!' }, a[1]]));
    assert.notEqual(contentHash(a), contentHash([{ ...a[0], botScope: 'SALES' }, a[1]]));
  });

  test('a reviewed audit is handed to /complete once, by hash', async () => {
    const report = await auditKnowledge({ company: COMPANY, documents: RICH_DOCS });
    rememberWizardAudit(report);
    assert.equal(takeWizardAudit(contentHash(RICH_DOCS)).readinessScore, report.readinessScore);
    assert.equal(takeWizardAudit(contentHash(RICH_DOCS)), null, 'used once');
  });
});
