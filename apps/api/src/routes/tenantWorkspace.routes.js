const express = require('express');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { issueApiKey } = require('../utils/tenantApiKeys');
const { invalidateTenantKnowledge } = require('../domains/tenantProfile');
const { crawlSite, CrawlerError } = require('../services/shared/crawler');
const { pdfToDocuments, PdfIngestError } = require('../services/shared/pdfIngest');
const { parseCategory, suggestCategory } = require('../services/shared/documentCategory');
const { crawlConsentRecord, hostOf } = require('../services/shared/crawlConsent');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { handleChat } = require('../services/tenantChat');
const { wrapRouterAsync } = require('../utils/wrapAsync');

// Everything one tenant can do with its own bots: documents, PDF upload,
// website import, API keys, test chat, tickets and usage.
//
// ISOLATION CONTRACT. Mounted twice, behind two different gatekeepers:
//   /api/v1/client/workspace          requireClient  (tenant from the client's TenantUser row)
//   /api/v1/tenants/:tenantId         requireOperator + loadTenantFromParam (KGT staff)
// Both set req.tenant and req.actor ('client' | 'operator') before any
// route here runs. Routes read the tenant ONLY from req.tenant; ids taken
// from the URL (document, key) are always looked up together with
// req.tenant.id, so another tenant's row reads exactly like a missing one.
const router = express.Router({ mergeParams: true });

const DOC_FIELDS = {
  id: true, title: true, content: true, category: true, sourceUrl: true, createdAt: true, updatedAt: true
};
const API_KEY_PUBLIC_FIELDS = { id: true, keyPrefix: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true };
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 20000;
const MAX_DOCUMENTS_PER_TENANT = 500;

// Website imports from client dashboards: a few per hour per tenant.
const isClientCrawlLimited = createIpRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

// ── PDF upload (same parser and 10MB limit as the signup wizard)
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 2 },
  fileFilter: (_req, file, cb) => {
    // Some browsers send application/octet-stream for a .pdf; the %PDF-
    // magic-byte check in pdfToDocuments is the real gate.
    const looksPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    cb(looksPdf ? null : new PdfIngestError('Only PDF files are accepted', 400), looksPdf);
  }
});

function pdfUploadMiddleware(req, res, next) {
  pdfUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof PdfIngestError) return res.status(err.statusCode).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `That PDF is larger than ${MAX_PDF_BYTES / (1024 * 1024)}MB` });
      }
      return res.status(400).json({ error: 'Upload exactly one PDF in a field named "file"' });
    }
    next(err);
  });
}

async function roomForDocuments(tenantId, adding) {
  const count = await prisma.tenantDocument.count({ where: { tenantId } });
  return count + adding <= MAX_DOCUMENTS_PER_TENANT;
}
const TOO_MANY_DOCS = { error: `A tenant can hold up to ${MAX_DOCUMENTS_PER_TENANT} documents — delete some to add more.` };

// ── Documents

// Optional ?category=FAQ filter; without it, every document is returned.
router.get('/documents', async (req, res) => {
  const where = { tenantId: req.tenant.id };
  if (req.query.category !== undefined) {
    const category = parseCategory(req.query.category, null);
    if (!category.ok || !category.value) return res.status(400).json({ error: category.error || 'category is empty' });
    where.category = category.value;
  }
  res.json(await prisma.tenantDocument.findMany({ where, orderBy: { createdAt: 'desc' }, select: DOC_FIELDS }));
});

router.post('/documents', async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, MAX_TITLE_LEN);
  const content = String(req.body?.content || '').trim().slice(0, MAX_CONTENT_LEN);
  if (!title || !content) return res.status(400).json({ error: 'title and content are required' });
  const category = parseCategory(req.body?.category);
  if (!category.ok) return res.status(400).json({ error: category.error });
  if (!(await roomForDocuments(req.tenant.id, 1))) return res.status(409).json(TOO_MANY_DOCS);

  const doc = await prisma.tenantDocument.create({
    data: { tenantId: req.tenant.id, title, content, category: category.value },
    select: DOC_FIELDS
  });
  invalidateTenantKnowledge(req.tenant.id); // next chat request re-reads from the DB
  res.status(201).json(doc);
});

// multipart: file (the PDF), optional category. With a category, every
// section is filed there; without one, each section gets the suggestion
// the signup wizard would make.
router.post('/documents/pdf', pdfUploadMiddleware, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a PDF in a field named "file"' });
  const chosen = req.body?.category ? parseCategory(req.body.category) : null;
  if (chosen && !chosen.ok) return res.status(400).json({ error: chosen.error });

  let parsed;
  try {
    parsed = await pdfToDocuments(req.file.buffer, req.file.originalname);
  } catch (e) {
    if (e instanceof PdfIngestError) return res.status(e.statusCode).json({ error: e.message });
    throw e;
  }
  if (!(await roomForDocuments(req.tenant.id, parsed.pages.length))) return res.status(409).json(TOO_MANY_DOCS);

  const docs = parsed.pages.map((p) => ({
    tenantId: req.tenant.id,
    title: p.title.slice(0, MAX_TITLE_LEN),
    content: p.markdown,
    category: chosen ? chosen.value : suggestCategory({ title: p.title, markdown: p.markdown, source: 'pdf' })
  }));
  await prisma.tenantDocument.createMany({ data: docs });
  invalidateTenantKnowledge(req.tenant.id);

  res.status(201).json({
    fileName: req.file.originalname,
    title: parsed.title,
    documentsCreated: docs.length,
    truncated: parsed.truncated,
    categories: docs.reduce((m, d) => ({ ...m, [d.category]: (m[d.category] || 0) + 1 }), {})
  });
});

router.patch('/documents/:documentId', async (req, res) => {
  const existing = await prisma.tenantDocument.findFirst({
    where: { id: req.params.documentId, tenantId: req.tenant.id }
  });
  if (!existing) return res.status(404).json({ error: 'Document not found' });

  const data = {};
  if (req.body?.title !== undefined) {
    const title = String(req.body.title).trim().slice(0, MAX_TITLE_LEN);
    if (!title) return res.status(400).json({ error: 'title cannot be empty' });
    data.title = title;
  }
  if (req.body?.content !== undefined) {
    const content = String(req.body.content).trim().slice(0, MAX_CONTENT_LEN);
    if (!content) return res.status(400).json({ error: 'content cannot be empty' });
    data.content = content;
  }
  if (req.body?.category !== undefined) {
    const category = parseCategory(req.body.category, null);
    if (!category.ok || !category.value) return res.status(400).json({ error: category.error || 'category cannot be empty' });
    data.category = category.value;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

  const updated = await prisma.tenantDocument.update({ where: { id: existing.id }, data, select: DOC_FIELDS });
  invalidateTenantKnowledge(req.tenant.id); // an edited chunk must be re-read on the very next chat request
  res.json(updated);
});

router.delete('/documents/:documentId', async (req, res) => {
  const { count } = await prisma.tenantDocument.deleteMany({
    where: { id: req.params.documentId, tenantId: req.tenant.id }
  });
  if (!count) return res.status(404).json({ error: 'Document not found' });
  invalidateTenantKnowledge(req.tenant.id); // a deleted chunk must stop being retrievable immediately
  res.status(204).end();
});

// ── Website import
// Operators get the headless-browser tier (Chromium runs --no-sandbox, so
// it stays behind staff auth); clients get the static crawler only, must
// confirm they're authorized to crawl the domain (recorded as a
// TenantConsent row), and are rate-limited per tenant.
router.post('/scrape', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url || !hostOf(url)) return res.status(400).json({ error: 'A valid website URL is required' });
  const isClient = req.actor === 'client';
  if (isClient) {
    if (req.body?.authorized !== true) {
      return res.status(400).json({ error: 'You must confirm you are authorized to let us crawl this domain' });
    }
    if (isClientCrawlLimited(req.tenant.id)) {
      return res.status(429).json({ error: 'Too many website imports. Please try again in an hour.' });
    }
  }

  let result;
  try {
    result = await crawlSite(url, { browserFallback: !isClient });
  } catch (e) {
    if (e instanceof CrawlerError) return res.status(e.statusCode).json({ error: e.message });
    throw e; // an unexpected failure — let the global error handler log and 500 it
  }
  if (!(await roomForDocuments(req.tenant.id, result.pages.length))) return res.status(409).json(TOO_MANY_DOCS);

  const created = await prisma.$transaction(async (tx) => {
    if (isClient) {
      await tx.tenantConsent.create({
        data: { tenantId: req.tenant.id, ...crawlConsentRecord({ url, email: req.tenantUser.email, req }) }
      });
    }
    return Promise.all(result.pages.map((page) => tx.tenantDocument.create({
      data: {
        tenantId: req.tenant.id,
        title: page.title.slice(0, MAX_TITLE_LEN),
        content: page.markdown,
        sourceUrl: page.url,
        // No review step here; the Documents list can re-file it afterwards.
        category: suggestCategory({ title: page.title, url: page.url, markdown: page.markdown, source: 'crawl' })
      },
      select: { id: true, title: true, sourceUrl: true, category: true }
    })));
  });
  invalidateTenantKnowledge(req.tenant.id);

  res.status(201).json({
    message:
      `Imported ${created.length} page${created.length === 1 ? '' : 's'} from ${result.baseHost} — both bots can use them now` +
      (result.rendered ? ` (${result.rendered} rendered in a headless browser)` : '') +
      (result.skipped ? `. Skipped ${result.skipped} low-content page${result.skipped === 1 ? '' : 's'}.` : '.'),
    crawled: result.crawled,
    skipped: result.skipped,
    rendered: result.rendered,
    documents: created
  });
});

// ── API keys. Plaintext is returned only by the POST that issues a key;
// the list shows prefixes and dates. Rotation is issue-then-revoke, so a
// live widget never has a moment without a valid key.

router.get('/api-keys', async (req, res) => {
  res.json(await prisma.tenantApiKey.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { createdAt: 'desc' },
    select: API_KEY_PUBLIC_FIELDS
  }));
});

router.post('/api-keys', async (req, res) => {
  const live = await prisma.tenantApiKey.count({ where: { tenantId: req.tenant.id, revokedAt: null } });
  if (live >= 10) return res.status(409).json({ error: 'A tenant can have up to 10 active keys — revoke one first.' });
  const label = String(req.body?.label || '').trim().slice(0, 80) || 'Default';
  const { key, row } = await issueApiKey(prisma, req.tenant.id, label);
  res.status(201).json({ id: row.id, keyPrefix: row.keyPrefix, label: row.label, createdAt: row.createdAt, apiKey: key });
});

router.delete('/api-keys/:keyId', async (req, res) => {
  const key = await prisma.tenantApiKey.findFirst({ where: { id: req.params.keyId, tenantId: req.tenant.id } });
  if (!key) return res.status(404).json({ error: 'API key not found' });
  if (key.revokedAt) return res.json({ id: key.id, revokedAt: key.revokedAt });

  const liveCount = await prisma.tenantApiKey.count({ where: { tenantId: req.tenant.id, revokedAt: null } });
  if (liveCount <= 1 && req.query.force !== 'true') {
    return res.status(409).json({
      error: 'This is the last active key — revoking it takes every embedded widget offline. Issue a new key first, or pass ?force=true.'
    });
  }
  res.json(await prisma.tenantApiKey.update({
    where: { id: key.id },
    data: { revokedAt: new Date() },
    select: API_KEY_PUBLIC_FIELDS
  }));
});

// ── Test chat: the tenant's own bots, authenticated by the session instead
// of an API key (keys are stored hashed and can't be read back).
router.post('/chat', handleChat);

// ── Tickets and usage

router.get('/tickets', async (req, res) => {
  res.json(await prisma.supportTicket.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, query: true, confidence: true, status: true, createdAt: true }
  }));
});

router.get('/usage', async (req, res) => {
  const [llm, conversations, messages] = await Promise.all([
    prisma.usageLog.aggregate({
      where: { tenantId: req.tenant.id },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, estimatedCostUsd: true }
    }),
    prisma.chatSession.count({ where: { tenantId: req.tenant.id } }),
    prisma.chatMessage.count({ where: { role: 'user', session: { tenantId: req.tenant.id } } })
  ]);
  res.json({
    calls: llm._count._all,
    promptTokens: llm._sum.promptTokens || 0,
    completionTokens: llm._sum.completionTokens || 0,
    estimatedCostUsd: llm._sum.estimatedCostUsd || 0,
    conversations,
    questions: messages
  });
});

// GET /usage/daily?days=30 — one row per UTC day (7–90 days, oldest first),
// zero-filled so charts have no gaps: questions asked, conversations started,
// AI answers generated, tokens used, and tickets filed.
router.get('/usage/daily', async (req, res) => {
  const days = Math.min(90, Math.max(7, Number.parseInt(req.query.days, 10) || 30));
  const tenantId = req.tenant.id;
  const rows = await prisma.$queryRaw`
    WITH d AS (
      SELECT generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => ${days - 1}::int),
                             date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day')::date AS day
    ),
    q AS (SELECT (m."createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
          FROM "ChatMessage" m JOIN "ChatSession" s ON s.id = m."sessionId"
          WHERE s."tenantId" = ${tenantId} AND m.role = 'user' GROUP BY 1),
    c AS (SELECT ("startedAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
          FROM "ChatSession" WHERE "tenantId" = ${tenantId} GROUP BY 1),
    u AS (SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n,
                 SUM("promptTokens" + "completionTokens")::int AS tokens
          FROM "UsageLog" WHERE "tenantId" = ${tenantId} GROUP BY 1),
    t AS (SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
          FROM "SupportTicket" WHERE "tenantId" = ${tenantId} GROUP BY 1)
    SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
           COALESCE(q.n, 0) AS questions, COALESCE(c.n, 0) AS conversations,
           COALESCE(u.n, 0) AS "aiAnswers", COALESCE(u.tokens, 0) AS tokens, COALESCE(t.n, 0) AS tickets
    FROM d LEFT JOIN q USING (day) LEFT JOIN c USING (day) LEFT JOIN u USING (day) LEFT JOIN t USING (day)
    ORDER BY d.day`;
  res.json({ days, series: rows });
});

// Wrapped here, not in app.js: this router is mounted inside other routers,
// and wrapRouterAsync only reaches a router's own routes, not nested ones.
module.exports = wrapRouterAsync(router);
module.exports.API_KEY_PUBLIC_FIELDS = API_KEY_PUBLIC_FIELDS;
