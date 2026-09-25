const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// Mocked before chatEngine.js is required (it destructures generateAnswer) —
// same pattern as chatEngine.test.js.
const llmClient = require('../src/engine/llmClient');
let capturedPrompts = [];
const generateAnswerMock = mock.method(llmClient, 'generateAnswer', async ({ systemPrompt, userPrompt }) => {
  capturedPrompts.push({ systemPrompt, userPrompt });
  return { text: 'You can return it within 30 days.', provider: 'mock', model: 'mock-1', usage: { promptTokens: 0, completionTokens: 0 } };
});

const prisma = require('../src/lib/prisma');
const { getEngineAnswer } = require('../src/engine/chatEngine');
const { rankItems } = require('../src/services/shared/lexicalSearch');
const { computeConfidence } = require('../src/engine/confidence');
const { parseCategory, suggestCategory, CATEGORY_VALUES } = require('../src/services/shared/documentCategory');
const {
  createTenantSupportProfile,
  createTenantSalesProfile,
  invalidateTenantKnowledge,
  SALES_SENTINEL,
  SUPPORT_SENTINEL
} = require('../src/domains/tenantProfile');

const TENANT = {
  id: 'tenant-cat',
  slug: 'acme',
  name: 'Acme',
  industryLabel: 'Home Goods',
  persona: null,
  outOfScopeMessage: "I don't have this info yet. Let me connect you with support.",
  minConfidence: 0.3
};

describe('documentCategory: parseCategory', () => {
  test('accepts every enum value (case-insensitive) and defaults a missing one to CORE_OVERVIEW', () => {
    for (const v of CATEGORY_VALUES) assert.deepEqual(parseCategory(v.toLowerCase()), { ok: true, value: v });
    assert.deepEqual(parseCategory(undefined), { ok: true, value: 'CORE_OVERVIEW' });
    assert.deepEqual(parseCategory(''), { ok: true, value: 'CORE_OVERVIEW' });
  });

  test('rejects anything else instead of silently re-filing it', () => {
    const result = parseCategory('PRICING');
    assert.equal(result.ok, false);
    assert.match(result.error, /CORE_OVERVIEW, FAQ, CUSTOM_POLICY/);
  });
});

describe('documentCategory: suggestCategory (sector-neutral defaults for the wizard tabs)', () => {
  const cases = [
    [{ url: 'https://acme.example/', title: 'Acme — Customer support software' }, 'CORE_OVERVIEW', 'homepage, whatever its tagline says'],
    [{ url: 'https://acme.example/about-us', title: 'About Acme' }, 'CORE_OVERVIEW', 'about page'],
    [{ url: 'https://acme.example/help/faq', title: 'Help' }, 'FAQ', 'faq path'],
    [{ url: 'https://clinic.example/patients/questions', title: 'Patients' }, 'FAQ', 'questions path (healthcare)'],
    [{ url: 'https://acme.example/pricing', title: 'Plans' }, 'CUSTOM_POLICY', 'pricing path (SaaS)'],
    [{ url: 'https://homes.example/tenancy-terms', title: 'Renting with us' }, 'CUSTOM_POLICY', 'terms path (real estate)'],
    [{ url: 'https://shop.example/shipping-returns', title: 'Delivery' }, 'CUSTOM_POLICY', 'returns path (e-commerce)'],
    [{ url: 'https://acme.example/blog/post', markdown: '## Is it safe?\n\nYes.\n\n## Is it fast?\n\nYes.\n\n## Is it cheap?\n\nYes.' }, 'FAQ', 'FAQ-shaped content'],
    [{ title: 'Product Manual', source: 'pdf' }, 'CUSTOM_POLICY', 'PDF manual'],
    [{ title: 'whey faq', source: 'pdf' }, 'FAQ', 'PDF FAQ'],
    [{ title: 'Company Profile 2026', source: 'pdf' }, 'CUSTOM_POLICY', 'unlabelled PDF defaults to the manuals tab']
  ];
  for (const [input, expected, label] of cases) {
    test(`${label} -> ${expected}`, () => assert.equal(suggestCategory(input), expected));
  }
});

describe('lexicalSearch: itemWeight / relativeMinScore', () => {
  const items = [
    { title: 'Returns', content: 'Return items within 30 days.', category: 'CORE_OVERVIEW' },
    { title: 'Returns', content: 'Return items within 30 days.', category: 'FAQ' },
    { title: 'Careers', content: 'We are hiring engineers.', category: 'FAQ' }
  ];

  test('a weight reorders equal matches but the reported rawScore is untouched', () => {
    const ranked = rankItems('return items', items, { minScore: 0, itemWeight: (i) => (i.category === 'FAQ' ? 2 : 1) });
    assert.equal(ranked[0].item.category, 'FAQ');
    assert.equal(ranked[0].rawScore, ranked[1].rawScore);
    assert.equal(ranked[0].score, ranked[0].rawScore * 2);
  });

  test('a weight can never turn a non-match into a match, even with minScore 0', () => {
    const ranked = rankItems('return items', items, { minScore: 0, itemWeight: () => 100 });
    assert.ok(!ranked.some((r) => r.item.title === 'Careers'));
  });

  test('minScore is applied to the unweighted score', () => {
    const lone = [{ title: 'X', content: 'return', category: 'FAQ' }];
    const raw = rankItems('return', lone, { minScore: 0 })[0].rawScore;
    assert.deepEqual(rankItems('return', lone, { minScore: raw + 1, itemWeight: () => 10 }), []);
  });

  test('relativeMinScore drops a weak tail match that would only pad the context', () => {
    const pool = [
      { title: 'Warranty', content: 'The warranty covers parts and labour for two years.' },
      { title: 'Careers', content: 'Our warehouse team works hard.' } // weak, incidental overlap
    ];
    const withTail = rankItems('warranty parts labour years', pool.concat({ title: 'Misc', content: 'years' }), { minScore: 0 });
    assert.equal(withTail.length, 2);
    const trimmed = rankItems('warranty parts labour years', pool.concat({ title: 'Misc', content: 'years' }), {
      minScore: 0,
      relativeMinScore: 0.35
    });
    assert.deepEqual(trimmed.map((r) => r.item.title), ['Warranty']);
  });
});

describe('tenant bots: category-weighted retrieval through the real engine', () => {
  // The same section filed under all three categories -> identical raw
  // scores, so ordering differences come purely from the category weights.
  const SAME =
    '## Setup and returns\n\nPlug in the device and hold the power button for five seconds. ' +
    'You can return any item within 30 days for a full refund.';
  const DOCS = [
    { title: 'About Acme', content: SAME, category: 'CORE_OVERVIEW' },
    { title: 'Help Center', content: SAME, category: 'FAQ' },
    { title: 'Returns Policy', content: SAME, category: 'CUSTOM_POLICY' },
    { title: 'Careers', content: '## Jobs\n\nWe hire designers.', category: 'CORE_OVERVIEW' }
  ];

  let originalFindMany;
  beforeEach(() => {
    originalFindMany = prisma.tenantDocument.findMany;
    prisma.tenantDocument.findMany = async () => DOCS;
    invalidateTenantKnowledge(TENANT.id);
    capturedPrompts = [];
    generateAnswerMock.mock.resetCalls();
  });
  afterEach(() => {
    prisma.tenantDocument.findMany = originalFindMany;
    invalidateTenantKnowledge(TENANT.id);
  });

  const firstExcerptKind = () => /\[Excerpt 1 — ([^—]+) —/.exec(capturedPrompts[0].userPrompt)[1].trim();

  test('every chunk carries its document category', async () => {
    const chunks = await createTenantSupportProfile(TENANT).resolveKnowledge();
    assert.deepEqual(chunks.map((c) => c.category), ['CORE_OVERVIEW', 'FAQ', 'CUSTOM_POLICY', 'CORE_OVERVIEW']);
  });

  test('support puts the FAQ excerpt first for a how-to question', async () => {
    await getEngineAnswer({ profile: createTenantSupportProfile(TENANT), query: 'how do I power on the device', ctx: {} });
    assert.equal(firstExcerptKind(), 'FAQ');
  });

  test('sales puts the company-overview excerpt first for the same question', async () => {
    await getEngineAnswer({ profile: createTenantSalesProfile(TENANT), query: 'how do I power on the device', ctx: {} });
    assert.equal(firstExcerptKind(), 'Company overview');
  });

  test('a money/rules question puts the policy excerpt first for BOTH bots', async () => {
    await getEngineAnswer({ profile: createTenantSupportProfile(TENANT), query: 'can I get a refund on a return', ctx: {} });
    await getEngineAnswer({ profile: createTenantSalesProfile(TENANT), query: 'can I get a refund on a return', ctx: {} });
    for (const { userPrompt } of capturedPrompts) {
      assert.match(userPrompt, /\[Excerpt 1 — Policy \/ pricing \/ manual —/);
    }
  });

  test('the support confidence gate uses the unweighted score, so weights never change gating', async () => {
    let seen;
    const profile = { ...createTenantSupportProfile(TENANT), minConfidence: 0.99, formatFallback: (_ctx, c) => (seen = c) };
    await getEngineAnswer({ profile, query: 'power button', ctx: {} });
    const chunks = await profile.resolveKnowledge();
    const raw = rankItems('power button', chunks, { minScore: 0 })[0].rawScore;
    assert.equal(seen, computeConfidence('power button', raw));
  });

  test('a question matching nothing never reaches the LLM — for sales too, which has no confidence gate', async () => {
    const result = await getEngineAnswer({ profile: createTenantSalesProfile(TENANT), query: 'zebra quantum saxophone', ctx: {} });
    assert.equal(generateAnswerMock.mock.callCount(), 0);
    assert.match(result.answer, /talk to our team/);
  });
});

describe('tenant bots: conversational prompt layer', () => {
  const support = createTenantSupportProfile(TENANT).systemPrompt({});
  const sales = createTenantSalesProfile(TENANT).systemPrompt({});

  test('both prompts keep strict grounding, then add the shared voice rules after it', () => {
    for (const p of [support, sales]) {
      assert.ok(p.indexOf('GROUNDING RULES') < p.indexOf('HOW TO SOUND'));
      assert.match(p, /never override the rules above/);
      assert.match(p, /Never invent|Do not invent/);
      assert.match(p, /no markdown/);
      assert.match(p, /Never mention "excerpts"/);
    }
  });

  test('each prompt tells the model to emit only its OWN sentinel when it cannot answer', () => {
    assert.match(support, new RegExp(`output only ${SUPPORT_SENTINEL} exactly`));
    assert.match(sales, new RegExp(`output only ${SALES_SENTINEL} exactly`));
  });

  test('support may use numbered steps for procedures; sales is prose-only', () => {
    assert.match(support, /short numbered sequence/);
    assert.doesNotMatch(sales, /numbered sequence/);
    assert.match(sales, /never lists/);
  });

  test('the degraded (LLM-down) fallback returns readable prose, not raw markdown', () => {
    const ranked = [{ chunk: { title: 'Returns', content: '## Returns\n\n- **30 days** to return\n- Free pickup' }, score: 5 }];
    const { answer } = createTenantSupportProfile(TENANT).formatDegraded(ranked);
    assert.doesNotMatch(answer, /##|\*\*|^- /m);
    assert.match(answer, /30 days to return/);
  });
});
