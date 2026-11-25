const crypto = require('crypto');
const { logger } = require('../lib/logger');
const defaultPrisma = require('../lib/prisma');
const { URL } = require('url');
const { fetchSafe, extractPage, CrawlerError } = require('./shared/crawler');
const { collectSitemapUrls } = require('./shared/sitemap');
const { suggestCategory } = require('./shared/documentCategory');
const { hostOf } = require('./shared/crawlConsent');
const { invalidateTenantKnowledge } = require('../domains/tenantProfile');
const { scheduleTenantAudit } = require('./botAuditor');
const { scheduleFaqGeneration } = require('./tenantFaqs');

// Full-site sitemap sync, weekly auto-refresh and change reports (Feature 2),
// built on top of the existing crawler + the new sitemap discovery. One run:
//   1. discover the pages the site advertises (services/shared/sitemap.js),
//   2. fetch + extract each (the SAME SSRF-guarded fetch and Markdown extraction
//      a normal crawl uses — services/shared/crawler.js), hashing the content,
//   3. diff against the tenant's existing website documents by source URL and
//      content hash: added / updated / unchanged / removed / errors,
//   4. apply the changes (additive create, in-place update, prune removed) and
//      persist a structured TenantCrawlRun change report.
//
// Strictly tenant-scoped (every query carries tenantId), additive to the
// grounded pipeline (documents land exactly as /scrape's do and knowledge is
// invalidated + re-audited afterwards), and defensive: one bad page is recorded
// as an error and never aborts the run. No external credentials are needed.

const MAX_PAGES_PER_SYNC = Number(process.env.SITEMAP_SYNC_MAX_PAGES) || 300;
const MAX_DOCUMENTS_PER_TENANT = 500; // mirrors routes/tenantWorkspace.routes.js
const MAX_TITLE_LEN = 200;
const FETCH_CONCURRENCY = 4;
const REPORT_DETAIL_CAP = 400; // per-page rows kept in the stored report
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

class KnowledgeSyncError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'KnowledgeSyncError';
    this.statusCode = statusCode;
  }
}

// A stable key for matching a crawled page to an existing document's sourceUrl:
// drop the fragment and a trailing slash (query is kept — it can be meaningful on
// a sitemap page). Falsey/invalid input returns '' so it never matches.
function normalizeUrlKey(url) {
  try {
    const u = new URL(String(url));
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/') && !s.endsWith('://') && new URL(s).pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return '';
  }
}

const hashContent = (text) => crypto.createHash('sha256').update(String(text || '')).digest('hex');
const siteHost = (url) => (hostOf(url) || '').replace(/^www\./, '');

// Default page fetcher: the crawler's SSRF-guarded fetch + Markdown extraction.
// Returns null for a non-HTML / unreachable page (recorded as skipped/error).
async function defaultFetchPage(url) {
  const fetched = await fetchSafe(url);
  if (!fetched) return null; // non-HTML content type
  const page = extractPage(fetched.html, fetched.finalUrl);
  return { title: page.title, markdown: page.markdown, finalUrl: fetched.finalUrl.toString(), wordCount: page.wordCount };
}

async function fetchAll(urls, fetchPage) {
  const pages = [];
  const errors = [];
  for (let i = 0; i < urls.length; i += FETCH_CONCURRENCY) {
    const batch = urls.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        const page = await fetchPage(url);
        if (!page || !String(page.markdown || '').trim()) return { url, error: 'No readable content' };
        return { url, page };
      } catch (err) {
        return { url, error: err instanceof CrawlerError ? err.message : (err.message || 'Could not fetch the page') };
      }
    }));
    for (const r of results) {
      if (r.error) errors.push({ url: r.url, error: r.error });
      else pages.push({ requestedUrl: r.url, ...r.page });
    }
  }
  return { pages, errors };
}

/**
 * Run one sitemap sync for a tenant and persist a change report.
 * @param {string} tenantId
 * @param {string} siteUrl
 * @param {{ prisma?, fetchPage?, collect?, now?, maxPages?, pruneRemoved?, trigger? }} [opts]
 * @returns {Promise<object>} the finished TenantCrawlRun-shaped summary
 */
async function runSitemapSync(tenantId, siteUrl, opts = {}) {
  const prisma = opts.prisma || defaultPrisma;
  const fetchPage = opts.fetchPage || defaultFetchPage;
  const collect = opts.collect || ((u) => collectSitemapUrls(u));
  const now = opts.now || Date.now();
  const maxPages = Math.max(1, Math.min(opts.maxPages || MAX_PAGES_PER_SYNC, MAX_PAGES_PER_SYNC));
  const pruneRemoved = opts.pruneRemoved !== false;
  const trigger = opts.trigger === 'scheduled' ? 'scheduled' : 'manual';

  if (!siteUrl || !hostOf(siteUrl)) throw new KnowledgeSyncError('A valid website URL is required');
  const host = siteHost(siteUrl);

  const run = await prisma.tenantCrawlRun.create({
    data: { tenantId, sourceUrl: siteUrl, trigger, status: 'running' },
    select: { id: true }
  });

  try {
    // 1. Discover + 2. fetch.
    const discovered = await collect(siteUrl);
    const urls = (discovered.urls || []).slice(0, maxPages);
    const { pages, errors } = await fetchAll(urls, fetchPage);

    // Collapse pages that resolved to the same final URL (keep the first).
    const byKey = new Map();
    for (const p of pages) {
      const key = normalizeUrlKey(p.finalUrl || p.requestedUrl);
      if (key && !byKey.has(key)) byKey.set(key, { ...p, key, hash: hashContent(p.markdown) });
    }

    // 3. Diff against existing website documents for this tenant on this host.
    const existing = await prisma.tenantDocument.findMany({
      where: { tenantId, sourceUrl: { not: null } },
      select: { id: true, sourceUrl: true, title: true, content: true }
    });
    const existingByKey = new Map();
    for (const doc of existing) {
      const key = normalizeUrlKey(doc.sourceUrl);
      if (key && siteHost(doc.sourceUrl) === host) existingByKey.set(key, { ...doc, hash: hashContent(doc.content) });
    }

    const added = [];
    const updated = [];
    const unchanged = [];
    for (const [key, page] of byKey) {
      const prior = existingByKey.get(key);
      if (!prior) added.push(page);
      else if (prior.hash !== page.hash) updated.push({ ...page, id: prior.id });
      else unchanged.push(page);
    }
    const removed = pruneRemoved
      ? [...existingByKey.entries()].filter(([key]) => !byKey.has(key)).map(([, doc]) => doc)
      : [];

    // 4. Apply, respecting the per-tenant document ceiling for new pages only.
    const room = Math.max(0, MAX_DOCUMENTS_PER_TENANT - existing.length);
    const toCreate = added.slice(0, room);
    const createdCount = toCreate.length;
    const addSkipped = added.length - createdCount;

    if (toCreate.length) {
      await prisma.tenantDocument.createMany({
        data: toCreate.map((p) => ({
          tenantId,
          title: String(p.title || p.key).slice(0, MAX_TITLE_LEN),
          content: p.markdown,
          sourceUrl: p.finalUrl || p.requestedUrl,
          category: suggestCategory({ title: p.title, url: p.finalUrl || p.requestedUrl, markdown: p.markdown, source: 'crawl' })
        }))
      });
    }
    for (const p of updated) {
      await prisma.tenantDocument.update({
        where: { id: p.id },
        data: { title: String(p.title || p.key).slice(0, MAX_TITLE_LEN), content: p.markdown }
      });
    }
    if (removed.length) {
      await prisma.tenantDocument.deleteMany({ where: { tenantId, id: { in: removed.map((d) => d.id) } } });
    }

    // Structured change report: counts + a capped per-page detail list.
    const detail = [
      ...toCreate.map((p) => ({ url: p.finalUrl || p.requestedUrl, title: p.title || '', status: 'added' })),
      ...updated.map((p) => ({ url: p.finalUrl || p.requestedUrl, title: p.title || '', status: 'updated' })),
      ...removed.map((d) => ({ url: d.sourceUrl, title: d.title || '', status: 'removed' })),
      ...unchanged.map((p) => ({ url: p.finalUrl || p.requestedUrl, title: p.title || '', status: 'unchanged' })),
      ...errors.map((e) => ({ url: e.url, title: '', status: 'error', error: e.error })),
      ...(addSkipped ? [{ url: '', title: '', status: 'skipped', error: `${addSkipped} new page(s) over the ${MAX_DOCUMENTS_PER_TENANT}-document limit` }] : [])
    ].slice(0, REPORT_DETAIL_CAP);

    const counts = {
      discovered: urls.length,
      added: createdCount,
      updated: updated.length,
      removed: removed.length,
      unchanged: unchanged.length,
      errors: errors.length,
      skipped: addSkipped,
      truncated: !!discovered.truncated
    };

    const finished = await prisma.tenantCrawlRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        finishedAt: new Date(now),
        pagesDiscovered: counts.discovered,
        pagesAdded: counts.added,
        pagesUpdated: counts.updated,
        pagesRemoved: counts.removed,
        pagesUnchanged: counts.unchanged,
        errorsCount: counts.errors,
        report: { counts, pages: detail, sitemaps: discovered.sitemaps || [] }
      }
    });

    await prisma.tenantCrawlSource.updateMany({
      where: { tenantId },
      data: { lastRunAt: new Date(now), lastRunId: run.id, lastStatus: 'completed' }
    });

    const changed = counts.added + counts.updated + counts.removed;
    if (changed) {
      await invalidateTenantKnowledge(tenantId).catch(() => {});
      scheduleTenantAudit(tenantId);
      scheduleFaqGeneration(tenantId);
    }

    return finished;
  } catch (err) {
    // Finalize the run as failed so the dashboard never shows a stuck "running".
    await prisma.tenantCrawlRun.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(now), report: { error: err.message } }
    }).catch(() => {});
    await prisma.tenantCrawlSource.updateMany({ where: { tenantId }, data: { lastRunAt: new Date(now), lastStatus: 'failed' } }).catch(() => {});
    if (err instanceof KnowledgeSyncError || err instanceof CrawlerError) throw err;
    throw new KnowledgeSyncError(err.message || 'The website sync failed', 500);
  }
}

// ── Per-tenant crawl source (the saved site + weekly schedule).

function toSourceView(row) {
  if (!row) return { url: null, weeklyEnabled: false, lastRunAt: null, lastRunId: null, lastStatus: null };
  return {
    url: row.url,
    weeklyEnabled: !!row.weeklyEnabled,
    lastRunAt: row.lastRunAt || null,
    lastRunId: row.lastRunId || null,
    lastStatus: row.lastStatus || null
  };
}

async function getCrawlSource(tenantId, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantCrawlSource.findUnique({ where: { tenantId } }).catch(() => null);
  return toSourceView(row);
}

async function saveCrawlSource(tenantId, body = {}, { prisma = defaultPrisma } = {}) {
  const data = {};
  if (body.url !== undefined) {
    const url = String(body.url || '').trim();
    if (url && !hostOf(url)) throw new KnowledgeSyncError('Enter a valid website address, e.g. https://example.com');
    data.url = url || null;
  }
  if (body.weeklyEnabled !== undefined) data.weeklyEnabled = !!body.weeklyEnabled;
  // Weekly refresh needs a URL to refresh.
  if (data.weeklyEnabled && data.url === null) throw new KnowledgeSyncError('Set a website address before turning on weekly auto-refresh.');
  if (data.weeklyEnabled && data.url === undefined) {
    const existing = await prisma.tenantCrawlSource.findUnique({ where: { tenantId } }).catch(() => null);
    if (!existing?.url) throw new KnowledgeSyncError('Set a website address before turning on weekly auto-refresh.');
  }
  if (!Object.keys(data).length) throw new KnowledgeSyncError('Nothing to update');
  const row = await prisma.tenantCrawlSource.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });
  return toSourceView(row);
}

function listCrawlRuns(tenantId, { prisma = defaultPrisma, limit = 20 } = {}) {
  return prisma.tenantCrawlRun.findMany({
    where: { tenantId },
    orderBy: { startedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 100)),
    select: {
      id: true, sourceUrl: true, trigger: true, status: true, startedAt: true, finishedAt: true,
      pagesDiscovered: true, pagesAdded: true, pagesUpdated: true, pagesRemoved: true, pagesUnchanged: true, errorsCount: true
    }
  });
}

function getCrawlRun(tenantId, runId, { prisma = defaultPrisma } = {}) {
  return prisma.tenantCrawlRun.findFirst({ where: { id: String(runId), tenantId } });
}

// ── Weekly scheduler. Off unless KNOWLEDGE_SYNC_ENABLED=true, so a deployment
// that hasn't opted in never crawls on its own. A source is due when weekly is on
// and it has never run or last ran over a week ago.

async function runDueSyncs({ now = Date.now(), prisma = defaultPrisma } = {}) {
  let rows = [];
  try {
    rows = await prisma.tenantCrawlSource.findMany({
      where: { weeklyEnabled: true, url: { not: null } },
      select: { tenantId: true, url: true, lastRunAt: true }
    });
  } catch (err) {
    logger.error(`[knowledgeSync] could not list sources: ${err.message}`);
    return { due: 0, ran: 0 };
  }
  const due = rows.filter((r) => !r.lastRunAt || (now - new Date(r.lastRunAt).getTime()) >= WEEK_MS);
  let ran = 0;
  for (const r of due) {
    try {
      await runSitemapSync(r.tenantId, r.url, { now, prisma, trigger: 'scheduled' });
      ran += 1;
    } catch (err) {
      logger.error(`[knowledgeSync] scheduled sync failed for tenant ${r.tenantId}: ${err.message}`);
    }
  }
  return { due: due.length, ran };
}

let syncTimer = null;

function startKnowledgeSyncWorker() {
  if (syncTimer) return syncTimer;
  if (String(process.env.KNOWLEDGE_SYNC_ENABLED || '').trim().toLowerCase() !== 'true') return null;
  const intervalMs = Math.max(1, Number(process.env.KNOWLEDGE_SYNC_INTERVAL_MIN || 6 * 60)) * 60 * 1000;
  syncTimer = setInterval(() => {
    runDueSyncs().catch((err) => logger.error(`[knowledgeSync] sweep error: ${err.message}`));
  }, intervalMs);
  syncTimer.unref?.();
  logger.info(`[knowledgeSync] weekly auto-refresh enabled (checking every ${Math.round(intervalMs / 60000)} min)`);
  return syncTimer;
}

function stopKnowledgeSyncWorker() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

module.exports = {
  runSitemapSync,
  getCrawlSource,
  saveCrawlSource,
  listCrawlRuns,
  getCrawlRun,
  runDueSyncs,
  startKnowledgeSyncWorker,
  stopKnowledgeSyncWorker,
  normalizeUrlKey,
  hashContent,
  toSourceView,
  KnowledgeSyncError,
  MAX_PAGES_PER_SYNC
};
