const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Stub the write-side side effects BEFORE requiring knowledgeSync (it destructures
// them at require time, same discipline as voiceChat.test.js), so a sync never
// invalidates a real cache, schedules an audit, or touches an LLM. prisma and the
// network (collect / fetchPage) are injected per-call, so nothing hits a DB or a site.
const tenantProfile = require('../../src/domains/tenantProfile');
tenantProfile.invalidateTenantKnowledge = async () => {};
const botAuditor = require('../../src/services/botAuditor');
botAuditor.scheduleTenantAudit = () => {};
const tenantFaqs = require('../../src/services/tenantFaqs');
tenantFaqs.scheduleFaqGeneration = () => {};

const knowledgeSync = require('../../src/services/knowledgeSync');
const { runSitemapSync, hashContent, normalizeUrlKey, saveCrawlSource, getCrawlSource } = knowledgeSync;

const TENANT = 't-sync';

function makePrisma(existingDocs = []) {
  const calls = { created: [], updated: [], deleted: [], runCreate: null, runUpdate: null, sourceUpdate: null };
  return {
    calls,
    tenantCrawlRun: {
      create: async ({ data }) => { calls.runCreate = data; return { id: 'run1' }; },
      update: async (args) => { calls.runUpdate = args; return { id: args.where.id, ...args.data }; }
    },
    tenantDocument: {
      findMany: async () => existingDocs,
      createMany: async ({ data }) => { calls.created.push(...data); return { count: data.length }; },
      update: async (args) => { calls.updated.push(args); return {}; },
      deleteMany: async (args) => { calls.deleted.push(args); return { count: (args.where.id.in || []).length }; }
    },
    tenantCrawlSource: { updateMany: async (args) => { calls.sourceUpdate = args; return { count: 1 }; } }
  };
}

// A page fetcher backed by a fixed url→markdown map; unknown urls "error".
const makeFetchPage = (pages) => async (url) => {
  if (!(url in pages)) throw new Error('boom');
  return { title: pages[url].title || url, markdown: pages[url].md, finalUrl: url, wordCount: 50 };
};

describe('knowledgeSync.runSitemapSync — first run (all new)', () => {
  let prisma;
  beforeEach(() => { prisma = makePrisma([]); });

  test('creates documents for new pages and records a change report; one fetch error is counted, not fatal', async () => {
    const collect = async () => ({ urls: ['https://acme.com/a', 'https://acme.com/b', 'https://acme.com/boom'], sitemaps: ['https://acme.com/sitemap.xml'], truncated: false });
    const fetchPage = makeFetchPage({
      'https://acme.com/a': { md: '## A\nalpha', title: 'A' },
      'https://acme.com/b': { md: '## B\nbeta', title: 'B' }
      // /boom is missing → throws → recorded as an error
    });

    const run = await runSitemapSync(TENANT, 'https://acme.com', { prisma, collect, fetchPage, now: Date.now() });

    assert.equal(prisma.calls.created.length, 2, 'two new documents created');
    assert.ok(prisma.calls.created.every((d) => d.tenantId === TENANT && d.sourceUrl), 'docs are tenant-scoped and carry sourceUrl');
    assert.equal(run.status, 'completed');
    assert.equal(run.pagesAdded, 2);
    assert.equal(run.pagesUpdated, 0);
    assert.equal(run.pagesRemoved, 0);
    assert.equal(run.errorsCount, 1);
    assert.equal(run.report.counts.discovered, 3);
    // The error page appears in the per-page detail.
    assert.ok(run.report.pages.some((p) => p.status === 'error' && p.url === 'https://acme.com/boom'));
    assert.ok(prisma.calls.sourceUpdate, 'the crawl source lastRunAt is updated');
  });
});

describe('knowledgeSync.runSitemapSync — re-run (added / updated / unchanged / removed)', () => {
  test('diffs against existing website docs by source URL and content hash', async () => {
    const existing = [
      { id: 'd-same', sourceUrl: 'https://acme.com/same', title: 'Same', content: '## Same\nunchanged body' },
      { id: 'd-upd', sourceUrl: 'https://acme.com/upd', title: 'Upd', content: '## Upd\nOLD body' },
      { id: 'd-gone', sourceUrl: 'https://acme.com/gone', title: 'Gone', content: '## Gone\nwill be removed' },
      // A document from a DIFFERENT host must never be touched by this site's sync.
      { id: 'd-other', sourceUrl: 'https://other.com/x', title: 'Other', content: '## Other\nx' }
    ];
    const prisma = makePrisma(existing);
    const collect = async () => ({ urls: ['https://acme.com/same', 'https://acme.com/upd', 'https://acme.com/new'], sitemaps: [], truncated: false });
    const fetchPage = makeFetchPage({
      'https://acme.com/same': { md: '## Same\nunchanged body', title: 'Same' }, // identical → unchanged
      'https://acme.com/upd': { md: '## Upd\nNEW body', title: 'Upd' },           // changed → updated
      'https://acme.com/new': { md: '## New\nbrand new', title: 'New' }           // not seen before → added
    });

    const run = await runSitemapSync(TENANT, 'https://acme.com', { prisma, collect, fetchPage });

    assert.equal(run.pagesAdded, 1);
    assert.equal(run.pagesUpdated, 1);
    assert.equal(run.pagesUnchanged, 1);
    assert.equal(run.pagesRemoved, 1);
    assert.equal(prisma.calls.created.length, 1);
    assert.equal(prisma.calls.updated.length, 1);
    assert.equal(prisma.calls.updated[0].where.id, 'd-upd');
    // Only the same-host, no-longer-present page is removed — never the other host's doc.
    assert.equal(prisma.calls.deleted.length, 1);
    assert.deepEqual(prisma.calls.deleted[0].where.id.in, ['d-gone']);
  });

  test('pruneRemoved:false keeps pages that dropped out of the sitemap', async () => {
    const existing = [{ id: 'd-gone', sourceUrl: 'https://acme.com/gone', title: 'Gone', content: 'x' }];
    const prisma = makePrisma(existing);
    const collect = async () => ({ urls: ['https://acme.com/a'], sitemaps: [], truncated: false });
    const fetchPage = makeFetchPage({ 'https://acme.com/a': { md: '## A\na', title: 'A' } });
    const run = await runSitemapSync(TENANT, 'https://acme.com', { prisma, collect, fetchPage, pruneRemoved: false });
    assert.equal(run.pagesRemoved, 0);
    assert.equal(prisma.calls.deleted.length, 0);
  });
});

describe('knowledgeSync.runSitemapSync — failure handling', () => {
  test('a discovery failure finalizes the run as failed (never left "running")', async () => {
    const prisma = makePrisma([]);
    const collect = async () => { throw new Error('sitemap unreachable'); };
    await assert.rejects(() => runSitemapSync(TENANT, 'https://acme.com', { prisma, collect }));
    assert.equal(prisma.calls.runUpdate.data.status, 'failed');
  });

  test('an invalid URL is refused before any run is created', async () => {
    const prisma = makePrisma([]);
    await assert.rejects(() => runSitemapSync(TENANT, 'not-a-url', { prisma }), (e) => e instanceof knowledgeSync.KnowledgeSyncError);
    assert.equal(prisma.calls.runCreate, null);
  });
});

describe('knowledgeSync helpers', () => {
  test('normalizeUrlKey drops the fragment and a trailing slash but keeps the query', () => {
    assert.equal(normalizeUrlKey('https://acme.com/a/#top'), 'https://acme.com/a');
    assert.equal(normalizeUrlKey('https://acme.com/a?x=1'), 'https://acme.com/a?x=1');
    assert.equal(normalizeUrlKey('https://acme.com/'), 'https://acme.com/');
    assert.equal(normalizeUrlKey('garbage'), '');
  });
  test('hashContent is stable and content-sensitive', () => {
    assert.equal(hashContent('abc'), hashContent('abc'));
    assert.notEqual(hashContent('abc'), hashContent('abd'));
  });
});

describe('knowledgeSync crawl source settings', () => {
  const sourceStore = () => {
    let row = null;
    return {
      tenantCrawlSource: {
        findUnique: async () => row,
        upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { tenantId: TENANT, weeklyEnabled: false, ...create }; return row; }
      }
    };
  };

  test('saves a URL and reads it back', async () => {
    const prisma = sourceStore();
    const saved = await saveCrawlSource(TENANT, { url: 'https://acme.com' }, { prisma });
    assert.equal(saved.url, 'https://acme.com');
    assert.equal((await getCrawlSource(TENANT, { prisma })).url, 'https://acme.com');
  });

  test('rejects an invalid URL and refuses weekly without a URL', async () => {
    const prisma = sourceStore();
    await assert.rejects(() => saveCrawlSource(TENANT, { url: 'nope' }, { prisma }), (e) => e instanceof knowledgeSync.KnowledgeSyncError);
    await assert.rejects(() => saveCrawlSource(TENANT, { weeklyEnabled: true }, { prisma }), (e) => e instanceof knowledgeSync.KnowledgeSyncError);
  });
});
