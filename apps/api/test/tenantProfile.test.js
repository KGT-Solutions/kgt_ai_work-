const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const {
  createTenantSupportProfile,
  createTenantSalesProfile,
  invalidateTenantKnowledge,
  SUPPORT_SENTINEL,
  SALES_SENTINEL
} = require('../src/domains/tenantProfile');

// prisma.tenantDocument.findMany is Proxy-backed (same reason
// leadCapture.test.js hand-mocks prisma.salesLead) — plain reassignment
// (which goes through the Proxy's set trap) rather than node:test's
// mock.method (which reads the own-property descriptor directly and sees
// `value: undefined` on a Prisma delegate).
let originalFindMany;
beforeEach(() => {
  originalFindMany = prisma.tenantDocument.findMany;
});
afterEach(() => {
  prisma.tenantDocument.findMany = originalFindMany;
});

const TENANT = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme Retail',
  industryLabel: 'Retail',
  persona: null,
  outOfScopeMessage: "I don't have this info yet. Let me connect you with support.",
  minConfidence: 0.3
};

describe('tenantProfile — support vs. sales identity (no cross-contamination)', () => {
  test('distinct profile ids', () => {
    const support = createTenantSupportProfile(TENANT);
    const sales = createTenantSalesProfile(TENANT);
    assert.equal(support.id, 'tenant:acme:support');
    assert.equal(sales.id, 'tenant:acme:sales');
    assert.notEqual(support.id, sales.id);
  });

  test('distinct sentinels — a support answer and a sales answer can never be confused for each other', () => {
    const support = createTenantSupportProfile(TENANT);
    const sales = createTenantSalesProfile(TENANT);
    assert.equal(support.noAnswerSentinel, SUPPORT_SENTINEL);
    assert.equal(sales.noAnswerSentinel, SALES_SENTINEL);
    assert.notEqual(support.noAnswerSentinel, sales.noAnswerSentinel);
  });

  test('only the support profile opts into the confidence gate (Tenant.minConfidence, the 30% default)', () => {
    const support = createTenantSupportProfile(TENANT);
    const sales = createTenantSalesProfile(TENANT);
    assert.equal(support.minConfidence, 0.3);
    assert.equal(sales.minConfidence, undefined);
  });

  test('system prompts never leak the other bot\'s sentinel or persona framing', () => {
    const supportPrompt = createTenantSupportProfile(TENANT).systemPrompt({});
    const salesPrompt = createTenantSalesProfile(TENANT).systemPrompt({});
    assert.match(supportPrompt, /support assistant/);
    assert.doesNotMatch(supportPrompt, /sales assistant/);
    assert.doesNotMatch(supportPrompt, new RegExp(SALES_SENTINEL));
    assert.match(salesPrompt, /sales assistant/i);
    assert.doesNotMatch(salesPrompt, /support assistant/);
    assert.doesNotMatch(salesPrompt, new RegExp(SUPPORT_SENTINEL));
  });

  test('the sales prompt instructs objection-handling and forbids fabricated discounts/meetings; the support prompt does not mention either', () => {
    const salesPrompt = createTenantSalesProfile(TENANT).systemPrompt({});
    assert.match(salesPrompt, /address any objection.*directly/i);
    assert.match(salesPrompt, /never fabricate a specific meeting time or discount/i);

    const supportPrompt = createTenantSupportProfile(TENANT).systemPrompt({});
    assert.doesNotMatch(supportPrompt, /discount/i);
  });
});

describe('tenantProfile — response shape differs per bot, same underlying chunk', () => {
  const rankedChunks = [{ chunk: { title: 'Return Policy', tags: ['benefit:free_returns'] }, score: 10 }];

  test('support.formatSuccess cites a sourceSection and carries no benefit badges', () => {
    const result = createTenantSupportProfile(TENANT).formatSuccess('Returns are free within 30 days.', rankedChunks, {});
    assert.equal(result.sourceSection, 'Return Policy');
    assert.equal(result.bot, 'support');
    assert.equal('keyBenefitsHighlighted' in result, false);
  });

  test('sales.formatSuccess surfaces tag-derived benefit badges and carries no sourceSection', () => {
    const result = createTenantSalesProfile(TENANT).formatSuccess('Returns are free within 30 days.', rankedChunks, {});
    assert.deepEqual(result.keyBenefitsHighlighted, ['Free Returns']);
    assert.equal(result.bot, 'sales');
    assert.equal('sourceSection' in result, false);
  });

  test('sales.formatFallback appends a generic next-step CTA the support fallback never adds', () => {
    const supportFallback = createTenantSupportProfile(TENANT).formatFallback({}, 0.1);
    const salesFallback = createTenantSalesProfile(TENANT).formatFallback({}, 0.1);
    assert.equal(supportFallback.answer, TENANT.outOfScopeMessage);
    assert.match(salesFallback.answer, /talk to our team/i);
    assert.ok(salesFallback.answer.startsWith(TENANT.outOfScopeMessage));
  });
});

describe('tenantProfile — support and sales share ONE cached knowledge pool per tenant', () => {
  test('resolveKnowledge() hits the DB once and is shared across both profiles until invalidated', async () => {
    invalidateTenantKnowledge(TENANT.id); // clean slate — other test files may share this in-process cache
    let calls = 0;
    prisma.tenantDocument.findMany = async () => {
      calls += 1;
      return [{ title: 'Doc A', content: '## Section\n\nContent.' }];
    };

    const support = createTenantSupportProfile(TENANT);
    const sales = createTenantSalesProfile(TENANT);

    const fromSupport = await support.resolveKnowledge();
    const fromSales = await sales.resolveKnowledge();

    assert.equal(calls, 1, 'the second profile must reuse the first profile\'s cached read, not hit the DB again');
    assert.deepEqual(fromSupport, fromSales);
  });

  test('invalidateTenantKnowledge forces both profiles to re-read on their next call', async () => {
    invalidateTenantKnowledge(TENANT.id);
    let calls = 0;
    prisma.tenantDocument.findMany = async () => {
      calls += 1;
      return [{ title: `Doc ${calls}`, content: '## Section\n\nContent.' }];
    };

    const profile = createTenantSupportProfile(TENANT);
    const first = await profile.resolveKnowledge();
    invalidateTenantKnowledge(TENANT.id); // e.g. an edit/delete/scrape just happened
    const second = await profile.resolveKnowledge();

    assert.equal(calls, 2);
    assert.notDeepEqual(first, second);
  });
});
