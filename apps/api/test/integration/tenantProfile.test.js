const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../../src/lib/prisma');
const {
  createTenantSupportProfile,
  createTenantSalesProfile,
  invalidateTenantKnowledge,
  SUPPORT_SENTINEL,
  SALES_SENTINEL
} = require('../../src/domains/tenantProfile');

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
  outOfScopeMessage: 'I want to make sure you get the exact right answer for that, so let me connect you with our team. Would you like to leave your email so we can reach out?',
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
    assert.match(salesPrompt, /handle objections head-on/i);
    assert.match(salesPrompt, /never fabricate a specific meeting time, booking link or discount/i);

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

  test("support's handoff is the tenant's own message; sales has its own warm one that offers a follow-up", () => {
    const supportFallback = createTenantSupportProfile(TENANT).formatFallback({}, 0.1);
    const salesFallback = createTenantSalesProfile(TENANT).formatFallback({}, 0.1);
    assert.equal(supportFallback.answer, TENANT.outOfScopeMessage);
    assert.match(salesFallback.answer, /quick note for our team/i);
    assert.notEqual(salesFallback.answer, supportFallback.answer);
    for (const r of [supportFallback, salesFallback]) {
      assert.doesNotMatch(r.answer, /I don't have this info|don't have the specifics/i);
    }
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

  test('a read that an edit overtakes is not cached, so the edit is visible on the next call', async () => {
    invalidateTenantKnowledge(TENANT.id);
    let content = 'OLD pricing content.';
    let release;
    const gate = new Promise((r) => { release = r; });
    prisma.tenantDocument.findMany = async () => {
      const rows = [{ title: 'Pricing', content: `## Pricing\n\n${content}` }]; // DB snapshot taken now...
      if (content.startsWith('OLD')) await gate; // ...but the reply arrives late
      return rows;
    };

    const profile = createTenantSupportProfile(TENANT);
    const inflight = profile.resolveKnowledge(); // a chat starts reading
    content = 'NEW pricing content.'; // PATCH /documents writes...
    invalidateTenantKnowledge(TENANT.id); // ...then invalidates, while the read is still in flight
    release();
    await inflight;

    const after = await profile.resolveKnowledge();
    assert.match(JSON.stringify(after), /NEW pricing content/);
  });
});

describe('tenantProfile — filterChunks hands retrieval a STABLE array per bot', () => {
  // filterChunks used to .filter() on every turn, so retrieval received a
  // brand-new array for every single message. That is invisible functionally
  // but defeats every cache in services/shared/lexicalSearch.js that is keyed
  // on array identity (the typo-correction vocabulary), which was being
  // rebuilt from the whole corpus on each request — measurably the dominant
  // cost of a chat turn on a content-heavy tenant.
  const DOCS = [
    { title: 'Pricing', content: '## Plans\n\nThe Pro plan is $40 per seat per month.' },
    { title: 'Help', content: '## Reset your password\n\nOpen settings and follow the steps to reset it.' },
    { title: 'About', content: '## Who we are\n\nWe are a company that sells things.' }
  ];

  test('the same bot gets the identical array object back until the knowledge is invalidated', async () => {
    invalidateTenantKnowledge(TENANT.id);
    prisma.tenantDocument.findMany = async () => DOCS;

    const support = createTenantSupportProfile(TENANT);
    const chunks = await support.resolveKnowledge();
    const first = support.filterChunks(chunks);
    const second = support.filterChunks(chunks);

    assert.equal(first, second, 'filterChunks must memoize, not re-filter per turn');
    assert.ok(first.length > 0);
  });

  test('each bot gets its own scoped array, and neither is the unfiltered pool', async () => {
    invalidateTenantKnowledge(TENANT.id);
    prisma.tenantDocument.findMany = async () => DOCS;

    const support = createTenantSupportProfile(TENANT);
    const sales = createTenantSalesProfile(TENANT);
    const chunks = await support.resolveKnowledge();

    const forSupport = support.filterChunks(chunks);
    const forSales = sales.filterChunks(chunks);

    assert.notEqual(forSupport, forSales, 'the two bots must not share one scoped array');
    assert.ok(forSupport.every((c) => c.scope === 'support' || c.scope === 'both'));
    assert.ok(forSales.every((c) => c.scope === 'sales' || c.scope === 'both'));
  });

  test('a single-bot company still gets every section, and that is cached separately from the both-bots split', async () => {
    invalidateTenantKnowledge(TENANT.id);
    prisma.tenantDocument.findMany = async () => DOCS;

    const chunks = await createTenantSupportProfile(TENANT).resolveKnowledge();
    const bothBots = createTenantSupportProfile({ ...TENANT, botPreference: 'both' }).filterChunks(chunks);
    const supportOnly = createTenantSupportProfile({ ...TENANT, botPreference: 'support' }).filterChunks(chunks);

    assert.equal(supportOnly.length, chunks.length, 'the only deployed bot uses all of the knowledge');
    assert.notEqual(supportOnly, bothBots, 'the preference is part of the cache key, not ignored');
    assert.ok(supportOnly.length > bothBots.length);
  });

  test('invalidating the knowledge drops the scoped arrays too, so an edit reaches retrieval', async () => {
    invalidateTenantKnowledge(TENANT.id);
    // Support-scoped on purpose: a pricing section classifies as "sales"
    // (services/shared/botScope.js), so the Support Bot would filter it out
    // and this test would assert against an empty array.
    let content = '## Reset your password\n\nOpen settings and follow the steps to reset it.';
    prisma.tenantDocument.findMany = async () => [{ title: 'Help', content }];

    const support = createTenantSupportProfile(TENANT);
    const before = support.filterChunks(await support.resolveKnowledge());
    assert.ok(before.length > 0, 'the fixture must be visible to the Support Bot');

    content = '## Reset your password\n\nOpen settings and follow the UPDATED steps to reset it.';
    invalidateTenantKnowledge(TENANT.id);
    const after = support.filterChunks(await support.resolveKnowledge());

    assert.notEqual(before, after, 'a new chunk array must produce a new scoped array');
    assert.match(JSON.stringify(after), /UPDATED steps/);
  });
});

describe('tenantProfile — a knowledge edit on ANOTHER instance invalidates this one', () => {
  // The chunk cache is per process, so with two API containers an edit handled
  // by one of them used to leave the other retrieving from the documents it
  // had already cached — for as long as that process lived. Nothing would ever
  // clear it, because invalidateTenantKnowledge only ran where the edit landed.
  //
  // The fix is a per-tenant knowledge generation in lib/sharedStore.js, which
  // loadTenantKnowledge now checks on every read. Here "the other instance" is
  // simulated by bumping that shared counter directly, which is exactly what
  // the other container's invalidateTenantKnowledge() would do.
  const { answerCache } = require('../../src/engine/answerCache');

  test('the cached chunks are dropped when the shared generation moves', async () => {
    await invalidateTenantKnowledge(TENANT.id);
    let content = '## Reset your password\n\nOpen settings and follow the steps to reset it.';
    let reads = 0;
    prisma.tenantDocument.findMany = async () => {
      reads += 1;
      return [{ title: 'Help', content }];
    };

    const support = createTenantSupportProfile(TENANT);
    const first = await support.resolveKnowledge();
    await support.resolveKnowledge();
    assert.equal(reads, 1, 'a warm cache must not re-read the database');
    assert.match(JSON.stringify(first), /follow the steps/);

    // The other container handles PATCH /documents: the row changes and it
    // bumps the shared generation. Nothing local is touched.
    content = '## Reset your password\n\nOpen settings and follow the UPDATED steps to reset it.';
    await answerCache.invalidateTenant(TENANT.id);

    const after = await support.resolveKnowledge();
    assert.equal(reads, 2, 'the moved generation must force a re-read');
    assert.match(JSON.stringify(after), /UPDATED steps/, 'this instance must see the edit');
  });

  test('an unchanged generation keeps serving the same array, so per-corpus caches still hit', async () => {
    await invalidateTenantKnowledge(TENANT.id);
    prisma.tenantDocument.findMany = async () => [{ title: 'Help', content: '## Reset your password\n\nFollow the steps.' }];

    const support = createTenantSupportProfile(TENANT);
    const a = await support.resolveKnowledge();
    const b = await support.resolveKnowledge();
    assert.equal(a, b, 'the same array object, or lexicalSearch rebuilds its vocabulary every turn');
  });
});
