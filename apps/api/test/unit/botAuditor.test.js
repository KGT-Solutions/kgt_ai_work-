const { test, describe, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Pre-flight readiness audit (services/botAuditor.js) and the Sales /
// Support classifier (services/shared/botScope.js). The LLM is a mock.

// No provider key, so even a missed mock can never reach a real LLM.
for (const k of ['GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) process.env[k] = '';
const llmClient = require('../../src/engine/llmClient');
mock.method(llmClient, 'isLlmConfigured', () => true);
let modelReply;
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async () => {
  if (modelReply instanceof Error) throw modelReply;
  return { text: modelReply, provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } };
});

const { classifyChunk, parseBotScope, parseBotPreference, scopeCounts, botCanUse } = require('../../src/services/shared/botScope');
const {
  auditKnowledge, parseAuditResponse, contentHash, levelFor, rememberWizardAudit, takeWizardAudit, PILLARS
} = require('../../src/services/botAuditor');

const COMPANY = { name: 'Acme', industryLabel: 'Smart home devices' };
const pillarsJson = (scores, extra = {}) => JSON.stringify({
  pillars: Object.fromEntries(PILLARS.map((p) => [p.id, { score: scores[p.id], summary: `${p.id} summary`, gaps: [`${p.id} gap`] }])),
  criticalGaps: { support: ['No support hours'], sales: ['No price for the Pro plan'] },
  requirements: { support: ['Add a troubleshooting FAQ'], sales: ['Upload your price list'] },
  ...extra
});
const long = (s, n) => Array.from({ length: n }, (_, i) => `${s} ${i}.`).join(' ');
// Enough text that each bot can use over 6000 characters (no content cap), split across both bots.
const RICH_DOCS = [
  { title: 'About Acme', content: `## Who we are\n\n${long('Acme builds smart thermostats for homes', 120)}`, category: 'CORE_OVERVIEW' },
  { title: 'Pricing', content: `## Plans\n\n${long('The Pro plan costs ₹999 per month with remote control', 100)}`, category: 'CUSTOM_POLICY' },
  { title: 'Help', content: `## Troubleshooting\n\n${long('If it is not working, reset the device and set it up again', 100)}`, category: 'FAQ' }
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
      { support: 1, sales: 1, both: 2, supportBot: 3, salesBot: 3, total: 4, deployed: ['support', 'sales'] });
  });
});

describe('auditKnowledge', () => {
  test('each bot gets its own training score, gaps and requirements; overall = the weakest bot', async () => {
    modelReply = pillarsJson({ identity: 90, features: 80, pricing: 40, support: 95, sales: 30 }, { readinessScore: 100 });
    const r = await auditKnowledge({ company: COMPANY, documents: RICH_DOCS });
    // Support: 90*.15 + 80*.20 + 40*.05 + 95*.60 = 88.5 -> 89 (sales pillar not counted)
    // Sales:   90*.15 + 80*.25 + 40*.30 + 30*.30 = 54.5 -> 55 (support pillar not counted)
    assert.equal(r.bots.support.score, 89);
    assert.equal(r.bots.support.level, 'Production Ready');
    assert.equal(r.bots.sales.score, 55);
    assert.equal(r.bots.sales.level, 'Moderate');
    assert.equal(r.readinessScore, 55, 'ready only when every deployed bot is — the model\'s own 100 is ignored');
    assert.equal(r.readinessLevel, 'Moderate');
    assert.deepEqual(r.bots.support.criticalGaps, ['No support hours']);
    assert.deepEqual(r.bots.sales.criticalGaps, ['No price for the Pro plan']);
    assert.deepEqual(r.bots.support.requirements, ['Add a troubleshooting FAQ']);
    assert.deepEqual(r.bots.sales.requirements, ['Upload your price list']);
    assert.deepEqual(r.bots.support.pillars.map((p) => p.id), ['identity', 'features', 'pricing', 'support']);
    assert.deepEqual(r.bots.sales.pillars.map((p) => p.id), ['identity', 'features', 'pricing', 'sales']);
    assert.deepEqual(r.criticalGaps, ['Support Bot: No support hours', 'Sales Bot: No price for the Pro plan']);
    assert.equal(r.method, 'llm');
    const call = generateAnswerMock.mock.calls[0].arguments[0];
    assert.equal(call.maxTokens, 3000);
    assert.match(call.systemPrompt, /separately for EACH assistant/);
    assert.match(call.userPrompt, /<content>[\s\S]*Pro plan costs ₹999/);
  });

  test('a model reply with one shared gap list still works — the gaps apply to every bot', async () => {
    modelReply = pillarsJson({ identity: 90, features: 90, pricing: 90, support: 90, sales: 90 },
      { criticalGaps: ['No SLA'], requirements: undefined, recommendations: ['Add your SLA'] });
    const r = await auditKnowledge({ company: COMPANY, documents: RICH_DOCS });
    assert.deepEqual(r.bots.support.criticalGaps, ['No SLA']);
    assert.deepEqual(r.bots.sales.requirements, ['Add your SLA']);
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
    assert.match(r.bots.support.criticalGaps[0], /characters of content for the Support Bot/);
  });

  test('each bot is capped by the text IT can use, not the total', async () => {
    modelReply = pillarsJson({ identity: 100, features: 100, pricing: 100, support: 100, sales: 100 });
    // Lots of support material, one short pricing line: Support is fully trained, Sales is not.
    const r = await auditKnowledge({ company: COMPANY, documents: [RICH_DOCS[2], { title: 'Pricing', content: '## Plans\n\nPro is ₹999 per month.' }] });
    assert.equal(r.bots.support.score, 100);
    assert.equal(r.bots.sales.score, 25);
    assert.equal(r.readinessScore, 25);
  });

  test('a bot left with no knowledge of its own scores 0, with a critical gap', async () => {
    const r = await auditKnowledge({ company: COMPANY, documents: [RICH_DOCS[0], RICH_DOCS[2]] });
    assert.equal(r.distribution.salesBot, 1, 'only the "both" overview section');
    assert.ok(r.distribution.supportBot >= 2);
    const onlySupport = await auditKnowledge({ company: COMPANY, documents: [{ ...RICH_DOCS[2], botScope: 'SUPPORT' }] });
    assert.equal(onlySupport.bots.sales.score, 0);
    assert.match(onlySupport.bots.sales.criticalGaps[0], /Sales Bot has no knowledge/);
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

describe('bot preference: one bot or both', () => {
  test('a single deployed bot uses every section; with both, the split applies', () => {
    assert.ok(botCanUse('support', 'sales', 'support'), 'Support-only: the price list is the support bot\'s too');
    assert.ok(botCanUse('sales', 'support', 'sales'), 'Sales-only: so are the manuals');
    assert.ok(!botCanUse('support', 'sales', 'both'));
    assert.ok(!botCanUse('sales', 'support', 'support'), 'an undeployed bot gets no special access');
    assert.deepEqual(scopeCounts([{ scope: 'support' }, { scope: 'sales' }, { scope: 'both' }], 'support'),
      { support: 1, sales: 1, both: 1, supportBot: 3, salesBot: 2, total: 3, deployed: ['support'] });
  });

  test('parseBotPreference', () => {
    assert.deepEqual(parseBotPreference('Sales'), { ok: true, value: 'sales' });
    assert.deepEqual(parseBotPreference(undefined), { ok: true, value: 'both' });
    assert.equal(parseBotPreference('marketing').ok, false);
  });

  test('Support-only: only the Support Bot is scored, a weak sales pillar costs nothing, and the prompt says so', async () => {
    modelReply = pillarsJson({ identity: 90, features: 80, pricing: 70, support: 60, sales: 0 });
    const r = await auditKnowledge({ company: COMPANY, documents: RICH_DOCS, botPreference: 'support' });
    // 90*.15 + 80*.20 + 70*.05 + 60*.60 = 69
    assert.equal(r.readinessScore, 69);
    assert.deepEqual(Object.keys(r.bots), ['support']);
    assert.equal(r.botPreference, 'support');
    assert.equal(r.pillarScores.find((p) => p.id === 'sales').inScope, false);
    assert.deepEqual(r.criticalGaps, ['No support hours'], 'one bot: no "Support Bot:" prefix');
    assert.deepEqual(r.distribution.deployed, ['support']);
    assert.equal(r.distribution.supportBot, r.distribution.total, 'one bot uses everything');
    assert.equal(r.bots.support.sections, r.distribution.total);
    const { systemPrompt } = generateAnswerMock.mock.calls[0].arguments[0];
    assert.match(systemPrompt, /one AI chat assistant/);
    assert.doesNotMatch(systemPrompt, /"sales": the Sales Bot/);
  });

  test('a single-bot company is never told the other bot lacks knowledge', async () => {
    const r = await auditKnowledge({ company: COMPANY, documents: [{ ...RICH_DOCS[2], botScope: 'SUPPORT' }], botPreference: 'support' });
    assert.ok(!r.criticalGaps.some((g) => /Sales Bot/.test(g)));
    const both = await auditKnowledge({ company: COMPANY, documents: [{ ...RICH_DOCS[2], botScope: 'SUPPORT' }] });
    assert.ok(both.criticalGaps.some((g) => /Sales Bot has no knowledge/.test(g)));
  });

  test('the preference is part of the report fingerprint (but "both" keeps the old hash)', () => {
    assert.equal(contentHash(RICH_DOCS, 'both'), contentHash(RICH_DOCS));
    assert.notEqual(contentHash(RICH_DOCS, 'sales'), contentHash(RICH_DOCS));
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
    assert.deepEqual(parsed.criticalGaps, { support: ['No prices'], sales: ['No prices'] }, 'a plain list applies to every bot');
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
