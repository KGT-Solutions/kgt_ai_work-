const express = require('express');
const { issueApiKey } = require('../utils/tenantApiKeys');
const prisma = require('../lib/prisma');
const { invalidateTenantKnowledge } = require('../domains/tenantProfile');
const { crawlSite, CrawlerError } = require('../services/shared/crawler');
const { parseCategory, suggestCategory } = require('../services/shared/documentCategory');

const router = express.Router();

function makeSlug(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// POST /api/v1/tenants — provision a new customer. Returns the API key ONCE;
// it's not retrievable again (same convention as any real API-key issuer).
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const industryLabel = String(req.body?.industryLabel || '').trim();
  if (!name || !industryLabel) {
    return res.status(400).json({ error: 'name and industryLabel are required' });
  }

  const slug = String(req.body?.slug || makeSlug(name));

  try {
    const { tenant, apiKey } = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name,
          slug,
          industryLabel,
          persona: req.body?.persona || null,
          outOfScopeMessage: req.body?.outOfScopeMessage || undefined,
          minConfidence: req.body?.minConfidence !== undefined ? Number(req.body.minConfidence) : undefined
        }
      });
      const { key } = await issueApiKey(tx, created.id);
      return { tenant: created, apiKey: key };
    });
    res.status(201).json({ ...tenant, apiKey });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'A tenant with that slug already exists' });
    throw e;
  }
});

router.get('/', async (req, res) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, slug: true, name: true, industryLabel: true, active: true,
      minConfidence: true, createdAt: true
    }
  });
  res.json(tenants);
});

router.get('/:tenantId', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.tenantId },
    select: {
      id: true, slug: true, name: true, industryLabel: true, persona: true, active: true,
      outOfScopeMessage: true, minConfidence: true, createdAt: true
    }
  });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
});

router.patch('/:tenantId', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const data = {};
  if (req.body?.active !== undefined) data.active = !!req.body.active;
  if (req.body?.persona !== undefined) data.persona = req.body.persona || null;
  if (req.body?.minConfidence !== undefined) data.minConfidence = Number(req.body.minConfidence);
  if (req.body?.outOfScopeMessage !== undefined) data.outOfScopeMessage = req.body.outOfScopeMessage;

  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data });
  res.json(updated);
});

// API keys. Plaintext is returned only by the POST that issues a key; the
// list shows prefixes and dates so admins can tell keys apart. Rotation is
// issue-then-revoke, so a live widget never has a moment without a valid key.
const API_KEY_PUBLIC_FIELDS = { id: true, keyPrefix: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true };

router.get('/:tenantId/api-keys', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const keys = await prisma.tenantApiKey.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    select: API_KEY_PUBLIC_FIELDS
  });
  res.json(keys);
});

router.post('/:tenantId/api-keys', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const label = String(req.body?.label || '').trim().slice(0, 80) || 'Default';
  const { key, row } = await issueApiKey(prisma, tenant.id, label);
  res.status(201).json({ id: row.id, keyPrefix: row.keyPrefix, label: row.label, createdAt: row.createdAt, apiKey: key });
});

router.delete('/:tenantId/api-keys/:keyId', async (req, res) => {
  const key = await prisma.tenantApiKey.findFirst({ where: { id: req.params.keyId, tenantId: req.params.tenantId } });
  if (!key) return res.status(404).json({ error: 'API key not found' });
  if (key.revokedAt) return res.json({ id: key.id, revokedAt: key.revokedAt });

  const liveCount = await prisma.tenantApiKey.count({ where: { tenantId: key.tenantId, revokedAt: null } });
  if (liveCount <= 1 && req.query.force !== 'true') {
    return res.status(409).json({
      error: "This is the tenant's last active key — revoking it takes every embedded widget offline. Issue a new key first, or pass ?force=true."
    });
  }
  const revoked = await prisma.tenantApiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
    select: API_KEY_PUBLIC_FIELDS
  });
  res.json(revoked);
});

router.post('/:tenantId/documents', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
  const category = parseCategory(req.body?.category);
  if (!category.ok) return res.status(400).json({ error: category.error });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const doc = await prisma.tenantDocument.create({
    data: { tenantId: tenant.id, title, content, category: category.value }
  });
  invalidateTenantKnowledge(tenant.id); // next chat request re-reads from the DB
  res.status(201).json(doc);
});

// POST /api/v1/tenants/:tenantId/scrape — auto-training from a company
// website: crawl a bounded set of same-domain pages, convert each into the
// same "## Heading" markdown shape a hand-pasted document already uses, and
// save one TenantDocument per page (sourceUrl set so the Documents Tab can
// show provenance and link back to the original page). Reuses the exact
// document pipeline (same table, same invalidateTenantKnowledge cache-bust)
// rather than writing to the filesystem — a tenant's knowledge base needs
// to survive a container restart/redeploy without a persistent volume, and
// this keeps scraped and hand-edited documents indistinguishable to both
// the support and sales profiles (domains/tenantProfile.js) reading from it.
router.post('/:tenantId/scrape', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  let result;
  try {
    // browserFallback: headless-Chromium rendering for SPA shells / bot-
    // blocked pages. Enabled ONLY here, behind operator auth — Chromium
    // runs --no-sandbox, so it must never be reachable by an anonymous
    // caller (publicRegister's /analyze stays static-only).
    result = await crawlSite(url, { browserFallback: true });
  } catch (e) {
    if (e instanceof CrawlerError) return res.status(e.statusCode).json({ error: e.message });
    throw e; // an unexpected failure — let the global error handler log and 500 it
  }

  const created = await prisma.$transaction(
    result.pages.map((page) =>
      prisma.tenantDocument.create({
        data: {
          tenantId: tenant.id,
          title: page.title.slice(0, 200),
          content: page.markdown,
          sourceUrl: page.url,
          // No review step on this admin path, so the suggestion is saved
          // as-is; the Documents tab can re-categorise it afterwards.
          category: suggestCategory({ title: page.title, url: page.url, markdown: page.markdown, source: 'crawl' })
        }
      })
    )
  );
  invalidateTenantKnowledge(tenant.id); // next chat request (support or sales) re-reads from the DB

  res.status(201).json({
    message:
      `Successfully extracted and indexed ${result.crawled} page${result.crawled === 1 ? '' : 's'} from ` +
      `${result.baseHost} — both bots can use ${created.length} new document${created.length === 1 ? '' : 's'} immediately` +
      (result.rendered ? ` (${result.rendered} rendered in a headless browser)` : '') +
      (result.skipped ? `. (Skipped ${result.skipped} low-content/non-HTML page${result.skipped === 1 ? '' : 's'}.)` : '.'),
    crawled: result.crawled,
    skipped: result.skipped,
    rendered: result.rendered,
    documents: created.map((doc) => ({ id: doc.id, title: doc.title, sourceUrl: doc.sourceUrl, category: doc.category }))
  });
});

// Optional ?category=FAQ filter; without it, every document is returned.
router.get('/:tenantId/documents', async (req, res) => {
  const where = { tenantId: req.params.tenantId };
  if (req.query.category !== undefined) {
    const category = parseCategory(req.query.category, null);
    if (!category.ok || !category.value) return res.status(400).json({ error: category.error || 'category is empty' });
    where.category = category.value;
  }
  const docs = await prisma.tenantDocument.findMany({ where, orderBy: { createdAt: 'desc' } });
  res.json(docs);
});

router.patch('/:tenantId/documents/:documentId', async (req, res) => {
  const existing = await prisma.tenantDocument.findFirst({
    where: { id: req.params.documentId, tenantId: req.params.tenantId }
  });
  if (!existing) return res.status(404).json({ error: 'Document not found' });

  const data = {};
  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) return res.status(400).json({ error: 'title cannot be empty' });
    data.title = title;
  }
  if (req.body?.content !== undefined) {
    const content = String(req.body.content).trim();
    if (!content) return res.status(400).json({ error: 'content cannot be empty' });
    data.content = content;
  }
  if (req.body?.category !== undefined) {
    const category = parseCategory(req.body.category, null);
    if (!category.ok || !category.value) return res.status(400).json({ error: category.error || 'category cannot be empty' });
    data.category = category.value;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

  const updated = await prisma.tenantDocument.update({ where: { id: existing.id }, data });
  invalidateTenantKnowledge(existing.tenantId); // an edited chunk must be re-read on the very next chat request
  res.json(updated);
});

router.delete('/:tenantId/documents/:documentId', async (req, res) => {
  const existing = await prisma.tenantDocument.findFirst({
    where: { id: req.params.documentId, tenantId: req.params.tenantId }
  });
  if (!existing) return res.status(404).json({ error: 'Document not found' });

  await prisma.tenantDocument.delete({ where: { id: existing.id } });
  invalidateTenantKnowledge(existing.tenantId); // a deleted chunk must stop being retrievable immediately
  res.status(204).end();
});

router.get('/:tenantId/tickets', async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({
    where: { tenantId: req.params.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(tickets);
});

router.get('/:tenantId/usage', async (req, res) => {
  const logs = await prisma.usageLog.findMany({ where: { tenantId: req.params.tenantId } });
  const summary = logs.reduce(
    (acc, l) => {
      acc.calls += 1;
      acc.promptTokens += l.promptTokens;
      acc.completionTokens += l.completionTokens;
      acc.estimatedCostUsd += l.estimatedCostUsd;
      return acc;
    },
    { calls: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 }
  );
  res.json(summary); // this is the shape a Stripe metered-billing sync job would read
});

module.exports = router;
