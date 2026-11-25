const express = require('express');
const { logger } = require('../lib/logger');
const multer = require('multer');
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { issueApiKey, normalizeAllowedOrigins } = require('../utils/tenantApiKeys');
const { invalidateTenantKnowledge } = require('../domains/tenantProfile');
const { crawlSite, CrawlerError } = require('../services/shared/crawler');
const { distillPages, isDistillationEnabled, isProductImportEnabled } = require('../services/llm-distillation/llmDistillation');
const { extractProducts, mergeProducts, isAutoProductExtractionEnabled } = require('../services/product-extractor/productExtractor');
const { pdfToDocuments, PdfIngestError } = require('../services/shared/pdfIngest');
const { parseCategory, suggestCategory } = require('../services/shared/documentCategory');
const { crawlConsentRecord, hostOf } = require('../services/shared/crawlConsent');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { handleChat } = require('../services/tenantChat');
const { transcribeAudio, isSttConfigured, MAX_AUDIO_BYTES } = require('../services/shared/speechToText');
const { isS2sConfigured } = require('../services/shared/speechToSpeech');
const { runVoiceChat } = require('../services/voiceChat');
const { detectLanguage } = require('../engine/language');
const { getMaskedConfig, upsertConfig, testConfig, SmtpConfigError } = require('../services/tenantSmtp');
const emailConnection = require('../services/emailConnection');
const { redirectUri: emailRedirectUri } = require('./emailOAuth.routes');
const crmSettings = require('../services/crm/crmSettings');
const { CrmError } = require('../services/crm/zohoAuth');
const { redirectUri: crmRedirectUri } = require('./crmOAuth.routes');
const hubspotSettings = require('../services/crm/hubspotSettings');
const { redirectUri: hubspotRedirectUri } = require('./hubspotOAuth.routes');
const branding = require('../services/branding');
const { LogoUploadError, MAX_LOGO_UPLOAD_BYTES, ACCEPTED_LOGO_TYPES } = require('../services/shared/logoUpload');
const { ingestCatalogCsv, replaceCatalog, getCatalogSummary, listProducts, addProduct, updateProduct, deleteProduct, importExtractedProducts, ProductError } = require('../services/catalogIngest');
const { CsvCatalogError, catalogTemplateCsv, MAX_CSV_BYTES } = require('../services/shared/csvCatalog');
const { inspectWorkbook, extractProductsFromWorkbook, XlsxCatalogError, MAX_XLSX_BYTES } = require('../services/shared/xlsxCatalog');
const knowledgeSync = require('../services/knowledgeSync');
const webhooks = require('../services/webhooks');
const sheetsSync = require('../services/sheetsSync');
const { redirectUri: sheetsRedirectUri } = require('./sheetsOAuth.routes');
const { scheduleFaqGeneration, isFaqGenerationRunning } = require('../services/tenantFaqs');
const { usageBreakdowns } = require('../services/usageStats');
const { wrapRouterAsync } = require('../utils/wrapAsync');
const { parseBotScope, parseBotPreference, scopeCounts } = require('../services/shared/botScope');
const { answerCache } = require('../engine/answerCache');
const { ingestUpload, FileIngestError, MAX_UPLOAD_BYTES } = require('../services/shared/fileIngest');
const { documentChunks } = require('../domains/tenantProfile');
const { auditTenant, tenantReadiness, recomputeReadiness, saveTenantReadiness, scheduleTenantAudit } = require('../services/botAuditor');
const { getGuardrails, saveGuardrails, parseGuardrailsInput } = require('../services/guardrails');
const { runSessionSummary, claimSession } = require('../services/chatSessions');
const { teamRecipients, parseTeamEmail, lowConfidenceBelow } = require('../services/teamAlerts');
const instructions = require('../services/tenantInstructions');
const escalationSvc = require('../services/escalation');
const helpdeskSettings = require('../services/helpdesk/helpdeskSettings');
const retention = require('../services/retention');
const { rowsToCsv, BOM } = require('../services/shared/csvExport');

// Everything one tenant can do with its own bots: documents, PDF upload,
// website import, API keys, test chat, tickets, leads and usage.
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
  id: true, title: true, content: true, category: true, botScope: true, sourceUrl: true, createdAt: true, updatedAt: true
};
const API_KEY_PUBLIC_FIELDS = { id: true, keyPrefix: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true, allowedOrigins: true };
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 20000;
const MAX_DOCUMENTS_PER_TENANT = 500;

// Website imports from client dashboards: a few per hour per tenant.
const isClientCrawlLimited = createIpRateLimiter({ name: 'workspace-crawl', max: 5, windowMs: 60 * 60 * 1000 });
// Manual starter-FAQ refreshes: each one is an LLM call, so a few per hour per tenant.
const isFaqRegenLimited = createIpRateLimiter({ name: 'workspace-faq-regen', max: 5, windowMs: 60 * 60 * 1000 });
// Readiness audits: each is an LLM call billed to the tenant.
const isAuditLimited = createIpRateLimiter({ name: 'workspace-audit', max: 6, windowMs: 60 * 60 * 1000 });

// Automated Intelligent Product Extractor hook (services/product-extractor/productExtractor.js).
// Runs AFTER the documents are already saved, over the same text, and upserts
// any products it finds into the catalog — so a website scrape, a PDF/brochure
// upload or a pasted note auto-populates the rich product cards with no separate
// CSV step. The cheap, verbatim heuristic runs whenever AUTO_PRODUCT_EXTRACTION
// is on (the default); the billable LLM pass is added only when the operator
// opted into SCRAPE_DISTILLATION_PRODUCTS. Best-effort and never throws: a
// failure here can only mean "no cards yet", never a failed upload. (The
// documents are already committed, so this is effectively a background top-up.)
async function autoPopulateCatalog(tenantId, text, { title = '' } = {}) {
  if (!isAutoProductExtractionEnabled()) return 0;
  try {
    const products = await extractProducts(text, { title, useLlm: isProductImportEnabled() });
    const { imported } = await importExtractedProducts(tenantId, products);
    return imported;
  } catch (err) {
    logger.warn(`[workspace] auto product extraction failed for tenant ${tenantId}: ${err.message}`);
    return 0;
  }
}

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
  const botScope = parseBotScope(req.body?.botScope);
  if (!botScope.ok) return res.status(400).json({ error: botScope.error });
  if (!(await roomForDocuments(req.tenant.id, 1))) return res.status(409).json(TOO_MANY_DOCS);

  const doc = await prisma.tenantDocument.create({
    data: { tenantId: req.tenant.id, title, content, category: category.value, botScope: botScope.value },
    select: DOC_FIELDS
  });
  await invalidateTenantKnowledge(req.tenant.id); // next chat request re-reads from the DB
  // A knowledge change makes the saved readiness report stale; re-audit in the
  // background so the dashboard score refreshes on its own instead of waiting for
  // a manual "Check again". Fire-and-forget and self-coalescing per tenant
  // (botAuditor.scheduleTenantAudit runs one audit at a time), so bulk uploads
  // and rapid edits can't burst the LLM.
  scheduleTenantAudit(req.tenant.id);
  // Auto-extract any products described in the pasted note into the catalog.
  const importedProducts = await autoPopulateCatalog(req.tenant.id, content, { title });
  res.status(201).json({ ...doc, importedProducts });
});

// ── Any supported file (PDF, .docx, .txt, .md, or a .zip of them), parsed
// by services/shared/fileIngest.js. multipart: file, optional category and
// botScope applied to every document created. Returns files[] so the client
// can show which files in a zip were skipped and why.
const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 3 } });

// Product catalog CSV upload. Small, single file, memory only. The extension
// is checked here; the content is validated by the parser (services/shared/csvCatalog.js).
const catalogUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CSV_BYTES, files: 1, fields: 2 } });

router.post('/documents/file', (req, res, next) => fileUpload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `Uploads are limited to ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` : 'Upload exactly one file in a field named "file"'
    });
  }
  next(err);
}), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a file in a field named "file"' });
  const chosen = req.body?.category ? parseCategory(req.body.category) : null;
  if (chosen && !chosen.ok) return res.status(400).json({ error: chosen.error });
  const botScope = parseBotScope(req.body?.botScope);
  if (!botScope.ok) return res.status(400).json({ error: botScope.error });

  let parsed;
  try {
    parsed = await ingestUpload(req.file.buffer, req.file.originalname);
  } catch (e) {
    if (e instanceof FileIngestError || e instanceof PdfIngestError) return res.status(e.statusCode).json({ error: e.message });
    throw e;
  }
  if (!(await roomForDocuments(req.tenant.id, parsed.pages.length))) return res.status(409).json(TOO_MANY_DOCS);

  const docs = parsed.pages.map((p) => ({
    tenantId: req.tenant.id,
    title: p.title.slice(0, MAX_TITLE_LEN),
    content: p.markdown,
    category: chosen ? chosen.value : suggestCategory({ title: p.title, markdown: p.markdown, source: 'pdf' }),
    botScope: botScope.value
  }));
  await prisma.tenantDocument.createMany({ data: docs });
  await invalidateTenantKnowledge(req.tenant.id);
  scheduleFaqGeneration(req.tenant.id);
  if (docs.length) scheduleTenantAudit(req.tenant.id); // only re-audit when something was actually added
  // Auto-extract products from the uploaded file (e.g. a catalog/brochure) into
  // the catalog, so its items show as rich cards with no CSV step.
  const text = parsed.pages.map((p) => `# ${p.title}\n${p.markdown}`).join('\n\n');
  const importedProducts = await autoPopulateCatalog(req.tenant.id, text, { title: req.file.originalname });
  res.status(201).json({ fileName: req.file.originalname, documentsCreated: docs.length, importedProducts, files: parsed.files });
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
  await invalidateTenantKnowledge(req.tenant.id);
  scheduleFaqGeneration(req.tenant.id); // new content -> fresh sandbox starter questions
  if (docs.length) scheduleTenantAudit(req.tenant.id); // only re-audit when something was actually added

  // Auto-extract products from the uploaded PDF (e.g. a product catalog/brochure).
  const text = parsed.pages.map((p) => `# ${p.title}\n${p.markdown}`).join('\n\n');
  const importedProducts = await autoPopulateCatalog(req.tenant.id, text, { title: parsed.title || req.file.originalname });

  res.status(201).json({
    fileName: req.file.originalname,
    title: parsed.title,
    documentsCreated: docs.length,
    importedProducts,
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
  // Which bot may use it: AUTO | BOTH | SUPPORT | SALES (services/shared/botScope.js).
  if (req.body?.botScope !== undefined) {
    const botScope = parseBotScope(req.body.botScope, null);
    if (!botScope.ok || !botScope.value) return res.status(400).json({ error: botScope.error || 'botScope cannot be empty' });
    data.botScope = botScope.value;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });

  const updated = await prisma.tenantDocument.update({ where: { id: existing.id }, data, select: DOC_FIELDS });
  await invalidateTenantKnowledge(req.tenant.id); // an edited chunk must be re-read on the very next chat request
  scheduleTenantAudit(req.tenant.id); // knowledge changed → refresh readiness in the background
  res.json(updated);
});

router.delete('/documents/:documentId', async (req, res) => {
  const { count } = await prisma.tenantDocument.deleteMany({
    where: { id: req.params.documentId, tenantId: req.tenant.id }
  });
  if (!count) return res.status(404).json({ error: 'Document not found' });
  await invalidateTenantKnowledge(req.tenant.id); // a deleted chunk must stop being retrievable immediately
  scheduleTenantAudit(req.tenant.id); // fewer documents can change readiness → refresh in the background
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
    if (await isClientCrawlLimited(req.tenant.id)) {
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

  // Tier 3 (opt-in, SCRAPE_DISTILLATION): clean each page's raw Markdown through
  // an LLM pass and collect any structured products. It never throws and falls
  // back to the raw text, so a failure here can only leave the pre-distillation
  // content — never block the import. Page count is unchanged.
  let distilledProducts = [];
  if (isDistillationEnabled()) {
    try {
      const distilled = await distillPages(result.pages);
      result.pages = distilled.pages;
      distilledProducts = distilled.products;
      if (distilled.distilledCount) {
        logger.info(`[scrape] distilled ${distilled.distilledCount}/${result.pages.length} pages for tenant ${req.tenant.id}`);
      }
    } catch (err) {
      logger.warn(`[scrape] distillation skipped for tenant ${req.tenant.id}: ${err.message}`);
    }
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
  await invalidateTenantKnowledge(req.tenant.id);
  scheduleFaqGeneration(req.tenant.id);
  if (created.length) scheduleTenantAudit(req.tenant.id); // only re-audit when pages were actually imported

  // Product import: the opt-in LLM pass above already produced `distilledProducts`
  // (SCRAPE_DISTILLATION_PRODUCTS); on top of that the default-on heuristic reads
  // the same pages (useLlm:false — don't pay for a second LLM pass). The merged,
  // de-duplicated set is upserted once (catalogIngest.importExtractedProducts),
  // so re-scraping a site refreshes rows rather than duplicating them. Best-effort
  // — a failure here can only leave the catalog unchanged, never block the import.
  let importedProducts = 0;
  try {
    const llmProducts = isProductImportEnabled() ? distilledProducts : [];
    const heuristicProducts = isAutoProductExtractionEnabled()
      ? await extractProducts(result.pages.map((p) => `# ${p.title}\n${p.markdown}`).join('\n\n'), { useLlm: false })
      : [];
    const merged = mergeProducts(llmProducts, heuristicProducts);
    if (merged.length) importedProducts = (await importExtractedProducts(req.tenant.id, merged)).imported;
  } catch (err) {
    logger.warn(`[scrape] product import skipped for tenant ${req.tenant.id}: ${err.message}`);
  }

  res.status(201).json({
    message:
      `Imported ${created.length} page${created.length === 1 ? '' : 's'} from ${result.baseHost} — both bots can use them now` +
      (result.rendered ? ` (${result.rendered} rendered in a headless browser)` : '') +
      (importedProducts ? ` and ${importedProducts} product${importedProducts === 1 ? '' : 's'}` : '') +
      (result.skipped ? `. Skipped ${result.skipped} low-content page${result.skipped === 1 ? '' : 's'}.` : '.'),
    crawled: result.crawled,
    skipped: result.skipped,
    rendered: result.rendered,
    importedProducts,
    documents: created
  });
});

// ── Starter FAQs: questions generated from this tenant's own documents
// (services/tenantFaqs.js), shown as one-click chips in the Test Bots sandbox.
// status: none (no documents yet) | pending | ready | failed. After a failed
// refresh the previous questions, if any, are still returned.
router.get('/faqs', async (req, res) => {
  const row = await prisma.tenantFaq.findUnique({ where: { tenantId: req.tenant.id } });
  let status = row?.status || 'none';

  // No row yet (a tenant from before this feature, or one whose only content
  // was typed in by hand), or a run lost to a restart: start one now.
  const stale = status === 'pending' && !isFaqGenerationRunning(req.tenant.id);
  if ((status === 'none' || stale) && await prisma.tenantDocument.count({ where: { tenantId: req.tenant.id } })) {
    scheduleFaqGeneration(req.tenant.id);
    status = 'pending';
  }

  res.json({
    status,
    supportFaqs: row?.supportFaqs || [],
    salesFaqs: row?.salesFaqs || [],
    // Hindi variants (index-aligned); the dashboard shows these when its
    // language toggle is on Hindi (components/workspace/BotSandbox.js).
    supportFaqsHi: row?.supportFaqsHi || [],
    salesFaqsHi: row?.salesFaqsHi || [],
    generatedAt: row?.generatedAt || null,
    // The failure reason names providers and config: staff only.
    ...(req.actor === 'operator' && row?.error ? { error: row.error } : {})
  });
});

// ── Product catalog: a CSV of products stored as structured, tenant-scoped
// rows plus a readable document the bots answer price/product questions from
// (services/catalogIngest.js). Strictly scoped to req.tenant.id.
router.get('/catalog', async (req, res) => {
  res.json(await getCatalogSummary(req.tenant.id));
});

// Per-item CRUD for the editable catalog table. All tenant-scoped; the
// catalog document the RAG reads is rebuilt after every change.
router.get('/catalog/products', async (req, res) => {
  res.json({ products: await listProducts(req.tenant.id) });
});

router.post('/catalog/products', async (req, res, next) => {
  try { res.status(201).json(await addProduct(req.tenant.id, req.body)); }
  catch (e) { if (e instanceof ProductError) return res.status(e.statusCode).json({ error: e.message }); next(e); }
});

router.patch('/catalog/products/:id', async (req, res, next) => {
  try { res.json(await updateProduct(req.tenant.id, req.params.id, req.body)); }
  catch (e) { if (e instanceof ProductError) return res.status(e.statusCode).json({ error: e.message }); next(e); }
});

router.delete('/catalog/products/:id', async (req, res, next) => {
  try { res.json(await deleteProduct(req.tenant.id, req.params.id)); }
  catch (e) { if (e instanceof ProductError) return res.status(e.statusCode).json({ error: e.message }); next(e); }
});

// A blank CSV template so tenants structure their catalog correctly.
router.get('/catalog/template', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="product-catalog-template.csv"');
  res.send(catalogTemplateCsv());
});

router.post('/catalog', (req, res, next) => catalogUpload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `Catalog files are limited to ${MAX_CSV_BYTES / (1024 * 1024)}MB` : 'Upload exactly one file in a field named "file"'
    });
  }
  next(err);
}), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a .csv file in a field named "file"' });
  if (!/\.csv$/i.test(req.file.originalname || '')) {
    return res.status(415).json({ error: 'Product catalogs must be a .csv file.' });
  }
  try {
    const result = await ingestCatalogCsv(req.tenant.id, req.file.buffer.toString('utf8'));
    res.status(201).json({ fileName: req.file.originalname, ...result });
  } catch (e) {
    if (e instanceof CsvCatalogError) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// ── Spreadsheet (.xlsx) catalog upload with sheet/column/price selection
// (Feature 1, services/shared/xlsxCatalog.js). Two steps, so the owner picks
// before importing: preview (inspect sheets/columns/sample rows) then import
// (the chosen sheet + column→field mapping). The file is NEVER stored — the
// import re-uploads it alongside the mapping. `selections` is a JSON form field.
const xlsxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_XLSX_BYTES, files: 1, fields: 2 } });
const xlsxUploadMiddleware = (req, res, next) => xlsxUpload.single('file')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `Spreadsheets are limited to ${MAX_XLSX_BYTES / (1024 * 1024)}MB` : 'Upload exactly one file in a field named "file"'
    });
  }
  next(err);
});
const isXlsxName = (name) => /\.xlsx$/i.test(String(name || ''));

router.post('/catalog/xlsx/preview', xlsxUploadMiddleware, async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Attach an .xlsx file in a field named "file"' });
  if (!isXlsxName(req.file.originalname)) return res.status(415).json({ error: 'Choose an .xlsx workbook. Save an older .xls file as .xlsx first.' });
  try {
    res.json({ fileName: req.file.originalname, ...(await inspectWorkbook(req.file.buffer)) });
  } catch (e) {
    if (e instanceof XlsxCatalogError) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

router.post('/catalog/xlsx/import', xlsxUploadMiddleware, async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Attach an .xlsx file in a field named "file"' });
  if (!isXlsxName(req.file.originalname)) return res.status(415).json({ error: 'Choose an .xlsx workbook. Save an older .xls file as .xlsx first.' });
  let selections;
  try {
    selections = typeof req.body?.selections === 'string' ? JSON.parse(req.body.selections) : req.body?.selections;
  } catch {
    return res.status(400).json({ error: 'The sheet/column selection was not valid.' });
  }
  try {
    const { products, skipped } = await extractProductsFromWorkbook(req.file.buffer, selections);
    // A bulk .xlsx import replaces the catalog, exactly like the CSV import.
    const result = await replaceCatalog(req.tenant.id, products);
    res.status(201).json({ fileName: req.file.originalname, ...result, skipped });
  } catch (e) {
    if (e instanceof XlsxCatalogError) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// ── Full-site sitemap sync, weekly auto-refresh & change reports (Feature 2,
// services/knowledgeSync.js). The saved source + weekly schedule, a manual
// "Sync now" (rate-limited like a crawl), and the change-report history. All
// strictly scoped to req.tenant.id.
router.get('/crawl-source', async (req, res) => {
  res.json(await knowledgeSync.getCrawlSource(req.tenant.id));
});

router.put('/crawl-source', async (req, res, next) => {
  try {
    res.json(await knowledgeSync.saveCrawlSource(req.tenant.id, req.body));
  } catch (e) {
    if (e instanceof knowledgeSync.KnowledgeSyncError) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

// "Sync now": run a sitemap sync immediately against the saved source (or a URL
// in the body). Clients confirm crawl authorization and are rate-limited per
// tenant, mirroring /scrape.
router.post('/crawl-source/sync', async (req, res, next) => {
  const isClient = req.actor === 'client';
  const source = await knowledgeSync.getCrawlSource(req.tenant.id);
  const url = String(req.body?.url || source.url || '').trim();
  if (!url || !hostOf(url)) return res.status(400).json({ error: 'Set a website address to sync first.' });
  if (isClient) {
    if (req.body?.authorized !== true && !source.url) {
      return res.status(400).json({ error: 'You must confirm you are authorized to let us crawl this domain' });
    }
    if (await isClientCrawlLimited(req.tenant.id)) {
      return res.status(429).json({ error: 'Too many website syncs. Please try again in an hour.' });
    }
  }
  // Persist the URL as the source if it was passed inline and none is saved yet.
  if (!source.url) await knowledgeSync.saveCrawlSource(req.tenant.id, { url }).catch(() => {});
  try {
    const run = await knowledgeSync.runSitemapSync(req.tenant.id, url, { trigger: 'manual' });
    res.status(201).json(run);
  } catch (e) {
    if (e instanceof knowledgeSync.KnowledgeSyncError || e instanceof CrawlerError) return res.status(e.statusCode).json({ error: e.message });
    next(e);
  }
});

router.get('/crawl-runs', async (req, res) => {
  res.json({ runs: await knowledgeSync.listCrawlRuns(req.tenant.id) });
});

router.get('/crawl-runs/:id', async (req, res) => {
  const run = await knowledgeSync.getCrawlRun(req.tenant.id, req.params.id);
  if (!run) return res.status(404).json({ error: 'Sync run not found' });
  res.json(run);
});

// ── Generic outbound webhooks (Feature 8, services/webhooks.js). CRUD, a test
// delivery, secret rotation, and the delivery log. The signing secret is
// returned only on create/rotate, never on list/get. All scoped to req.tenant.id.
function sendWebhookError(err, res, next) {
  if (err instanceof webhooks.WebhookError) return res.status(err.statusCode).json({ error: err.message });
  return next(err);
}

router.get('/webhooks', async (req, res) => {
  res.json(await webhooks.listWebhooks(req.tenant.id));
});

// Delivery log (most recent first); ?webhookId= narrows to one endpoint.
router.get('/webhooks/deliveries', async (req, res) => {
  res.json(await webhooks.listDeliveries(req.tenant.id, { webhookId: req.query.webhookId ? String(req.query.webhookId) : null }));
});

// Create → returns the webhook PLUS the plaintext signing secret, once.
router.post('/webhooks', async (req, res, next) => {
  try {
    res.status(201).json(await webhooks.createWebhook(req.tenant.id, req.body || {}));
  } catch (err) { sendWebhookError(err, res, next); }
});

router.patch('/webhooks/:id', async (req, res, next) => {
  try {
    res.json(await webhooks.updateWebhook(req.tenant.id, req.params.id, req.body || {}));
  } catch (err) { sendWebhookError(err, res, next); }
});

router.delete('/webhooks/:id', async (req, res, next) => {
  try {
    res.json(await webhooks.deleteWebhook(req.tenant.id, req.params.id));
  } catch (err) { sendWebhookError(err, res, next); }
});

// Rotate the signing secret → returns the new plaintext secret, once.
router.post('/webhooks/:id/rotate-secret', async (req, res, next) => {
  try {
    res.json(await webhooks.rotateSecret(req.tenant.id, req.params.id));
  } catch (err) { sendWebhookError(err, res, next); }
});

// Send a one-off `ping` delivery so the owner can confirm their receiver works.
router.post('/webhooks/:id/test', async (req, res, next) => {
  try {
    res.json(await webhooks.testWebhook(req.tenant.id, req.params.id));
  } catch (err) { sendWebhookError(err, res, next); }
});

// ── Google Sheets sync (Feature 8, services/sheetsSync.js). Connect a Google
// account (consent URL for the browser; the public callback stores encrypted
// tokens), choose a spreadsheet, and pick which events append a row. Status never
// returns tokens.
function sendSheetsError(err, res, next) {
  if (err instanceof sheetsSync.SheetsSyncError) return res.status(err.statusCode).json({ error: err.message });
  return next(err);
}
const sheetsActor = (req) => req.tenantUser?.email || req.actor || 'client';

router.get('/sheets-sync', async (req, res, next) => {
  try {
    res.json(await sheetsSync.getStatus(req.tenant));
  } catch (err) { sendSheetsError(err, res, next); }
});

router.post('/sheets-sync/connect', async (req, res, next) => {
  try {
    res.json(await sheetsSync.beginConnect({ tenantId: req.tenant.id, redirectUri: sheetsRedirectUri(req), actor: sheetsActor(req) }));
  } catch (err) { sendSheetsError(err, res, next); }
});

router.post('/sheets-sync/disconnect', async (req, res, next) => {
  try {
    res.json(await sheetsSync.disconnect(req.tenant));
  } catch (err) { sendSheetsError(err, res, next); }
});

// body { spreadsheetId?, spreadsheetName?, events?, enabled? }
router.put('/sheets-sync/settings', async (req, res, next) => {
  try {
    res.json(await sheetsSync.saveSettings(req.tenant, req.body || {}));
  } catch (err) { sendSheetsError(err, res, next); }
});

// ── Custom SMTP: a tenant's own mail server for ticket alerts, lead emails
// and notifications (services/tenantSmtp.js, services/mailer.js). The
// password is encrypted at rest and never returned — GET masks it.
router.get('/smtp-config', async (req, res) => {
  res.json(await getMaskedConfig(req.tenant.id));
});

router.put('/smtp-config', async (req, res, next) => {
  try {
    res.json(await upsertConfig(req.tenant.id, req.body));
  } catch (err) {
    if (err instanceof SmtpConfigError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// Verifies credentials against the mail server without saving. Returns
// { ok, reason?, error?, hint? }; a bad login is a 200 with ok:false (it's a
// validation result, not a server error).
router.post('/smtp-config/test', async (req, res, next) => {
  try {
    res.json(await testConfig(req.tenant.id, req.body));
  } catch (err) {
    next(err);
  }
});

// ── Email Connection (Feature 10, services/emailConnection.js). Google /
// Microsoft send-only OAuth + per-email-type toggles, alongside the custom SMTP
// above. Status never returns tokens; connect hands back a consent URL the
// browser opens, and the public callback (routes/emailOAuth.routes.js) stores
// the encrypted tokens. Custom SMTP keeps working unchanged.
function sendEmailConnError(err, res, next) {
  if (err instanceof emailConnection.EmailConnectionError) return res.status(err.statusCode).json({ error: err.message });
  return next(err);
}
const emailActor = (req) => req.tenantUser?.email || req.actor || 'client';

router.get('/email-connection', async (req, res, next) => {
  try {
    res.json(await emailConnection.getStatus(req.tenant));
  } catch (err) {
    sendEmailConnError(err, res, next);
  }
});

// body { provider: 'google' | 'microsoft' } → { authUrl } for the browser to open.
router.post('/email-connection/connect', async (req, res, next) => {
  try {
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    res.json(await emailConnection.beginConnect({
      tenantId: req.tenant.id, provider, redirectUri: emailRedirectUri(req, provider), actor: emailActor(req)
    }));
  } catch (err) {
    sendEmailConnError(err, res, next);
  }
});

router.post('/email-connection/disconnect', async (req, res, next) => {
  try {
    res.json(await emailConnection.disconnect(req.tenant));
  } catch (err) {
    sendEmailConnError(err, res, next);
  }
});

// body { leadAlerts?, attentionAlerts?, visitorConfirmation? } (booleans) —
// per-email-type toggles enforced before each category sends.
router.put('/email-connection/toggles', async (req, res, next) => {
  try {
    res.json(await emailConnection.setToggles(req.tenant, {
      leadAlerts: req.body?.leadAlerts, attentionAlerts: req.body?.attentionAlerts, visitorConfirmation: req.body?.visitorConfirmation
    }));
  } catch (err) {
    sendEmailConnError(err, res, next);
  }
});

// ── CRM integrations (services/crm/*). The dashboard's Integrations page.
// Status never returns tokens; connect hands back a Zoho consent URL the
// browser opens, and the public callback (routes/crmOAuth.routes.js) finishes
// the flow and stores the encrypted tokens.
router.get('/crm', async (req, res) => {
  res.json(await crmSettings.getCrmStatus(req.tenant.id));
});

router.post('/crm/connect', async (req, res, next) => {
  try {
    // Either { authUrl } (OAuth redirect) or { connected: true } (server token).
    const result = await crmSettings.beginConnect({
      tenantId: req.tenant.id, region: req.body?.region, redirectUri: crmRedirectUri(req)
    });
    res.json(result);
  } catch (err) {
    if (err instanceof CrmError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/crm/disconnect', async (req, res) => {
  res.json(await crmSettings.disconnect(req.tenant.id));
});

// ── HubSpot CRM (Feature 9, services/crm/hubspot*). Same shape as the Zoho
// routes above: status never returns tokens; connect hands back a HubSpot consent
// URL the browser opens, and the public callback (routes/hubspotOAuth.routes.js)
// finishes the flow and stores the encrypted tokens. One CRM per tenant, so
// connect is refused (409) while Zoho holds the slot.
router.get('/crm/hubspot', async (req, res) => {
  res.json(await hubspotSettings.getHubspotStatus(req.tenant.id));
});

router.post('/crm/hubspot/connect', async (req, res, next) => {
  try {
    const result = await hubspotSettings.beginConnect({
      tenantId: req.tenant.id, redirectUri: hubspotRedirectUri(req)
    });
    res.json(result);
  } catch (err) {
    if (err instanceof CrmError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/crm/hubspot/disconnect', async (req, res) => {
  res.json(await hubspotSettings.disconnect(req.tenant.id));
});

// ── Bot Branding & Theme Studio (services/branding.js). The brand kit and
// three generated widget designs; the selected design is what the embeddable
// widget renders (GET /tenant-chat/:slug/theme).
// A rescan fetches someone's homepage and stylesheets, so it's rate-limited per tenant.
const isBrandScanLimited = createIpRateLimiter({ name: 'workspace-brand-scan', max: 6, windowMs: 60 * 60 * 1000 });

function sendBrandingError(err, res, next) {
  if (err instanceof branding.BrandingError || err instanceof CrawlerError || err instanceof LogoUploadError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return next(err);
}

// Logo uploads: one image, checked by its type here and by its actual bytes in
// shared/logoUpload.js (which re-encodes it — the upload itself is never stored).
const isLogoUploadLimited = createIpRateLimiter({ name: 'workspace-logo-upload', max: 20, windowMs: 60 * 60 * 1000 });
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_UPLOAD_BYTES, files: 1, fields: 0 },
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_LOGO_TYPES.includes(file.mimetype)) return cb(null, true);
    return cb(new LogoUploadError('The logo must be a PNG, JPEG or WebP image.'));
  }
});
function parseLogoUpload(req, res, next) {
  logoUpload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof LogoUploadError) return res.status(err.statusCode).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? `Logos are limited to ${MAX_LOGO_UPLOAD_BYTES / (1024 * 1024)}MB.` : 'Upload one image in a field named "logo"'
      });
    }
    return next(err);
  });
}

router.get('/branding', async (req, res, next) => {
  try {
    res.json(await branding.getBranding(req.tenant));
  } catch (err) {
    sendBrandingError(err, res, next);
  }
});

// body { themeId } — a design id, or null for the classic look. themeId must be
// sent explicitly, so an empty body can't silently revert a live design.
router.post('/branding/select', async (req, res, next) => {
  if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'themeId')) {
    return res.status(400).json({ error: 'themeId is required (a design id, or null for the classic look)' });
  }
  try {
    res.json(await branding.selectTheme(req.tenant, req.body.themeId));
  } catch (err) {
    sendBrandingError(err, res, next);
  }
});

// body { url } — re-read logo + colours from this site and regenerate the designs.
router.post('/branding/scan', async (req, res, next) => {
  if (await isBrandScanLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'Too many website scans. Please try again in an hour.' });
  }
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    res.json(await branding.rescanBranding(req.tenant, url));
  } catch (err) {
    sendBrandingError(err, res, next);
  }
});

// body { logoUrl?, primaryColor?, botName?, showBranding? } — manual edits; '' or null clears
// text fields. showBranding (boolean) shows/hides the free "Powered by KGT Orb" footer strip.
// A logo URL makes the server download and decode that image (twice: analyse,
// then clean), so it draws on the same per-tenant budget as a website scan —
// unthrottled, pasting URLs in a loop was a CPU sink and a way to point our
// servers at third-party hosts. Clearing the logo or saving a colour/name doesn't count.
router.patch('/branding', async (req, res, next) => {
  const logoUrl = req.body?.logoUrl;
  if (typeof logoUrl === 'string' && logoUrl.trim() && await isBrandScanLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'Too many logo or website lookups. Please try again in an hour.' });
  }
  try {
    res.json(await branding.updateBrandKit(req.tenant, {
      logoUrl: req.body?.logoUrl, primaryColor: req.body?.primaryColor, botName: req.body?.botName,
      showBranding: req.body?.showBranding
    }));
  } catch (err) {
    sendBrandingError(err, res, next);
  }
});

// multipart field "logo" (PNG / JPEG / WebP, ≤ 2 MB) — becomes THE logo, ahead
// of any scanned or pasted one; the designs are regenerated around it.
router.post('/branding/logo', async (req, res, next) => {
  if (await isLogoUploadLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'Too many logo uploads. Please try again in an hour.' });
  }
  return next();
}, parseLogoUpload, async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image file to upload (field "logo").' });
  try {
    res.json(await branding.uploadLogo(req.tenant, req.file.buffer));
  } catch (err) {
    sendBrandingError(err, res, next);
  }
});

// Remove the logo (uploaded or linked): the widget shows the company's initial.
router.delete('/branding/logo', async (req, res, next) => {
  try {
    res.json(await branding.removeLogo(req.tenant));
  } catch (err) {
    sendBrandingError(err, res, next);
  }
});

// ── Client-facing Instructions Editor (Feature 11, services/tenantInstructions.js).
// The owner tunes each assistant's tone/style/length and a little free-text
// guidance; the locked grounding/safety/pricing rules stay server-side and
// cannot be overridden (the directive is appended strictly subordinate to
// them). Every save is versioned; a previous version can be viewed and restored.
const instructionActor = (req) => req.tenantUser?.email || req.actor || 'client';
function sendInstructionError(err, res, next) {
  if (err instanceof instructions.InstructionError) return res.status(err.statusCode).json({ error: err.message });
  return next(err);
}

// The current settings for one assistant, plus the preset catalog the UI renders.
// ?botType=support|sales (defaults to support).
router.get('/instructions', async (req, res, next) => {
  try {
    const botType = req.query.botType || 'support';
    res.json({ ...(await instructions.getInstructions(req.tenant, botType)), presets: instructions.PRESETS });
  } catch (err) {
    sendInstructionError(err, res, next);
  }
});

// body { botType, tone?, style?, length?, guidance?, summary? } — save and
// snapshot a new version. '' / null clears a preset; the locked rules are
// unaffected regardless of what is sent.
router.put('/instructions', async (req, res, next) => {
  try {
    res.json(await instructions.updateInstructions(req.tenant, req.body?.botType, {
      tone: req.body?.tone, style: req.body?.style, length: req.body?.length,
      guidance: req.body?.guidance, summary: req.body?.summary, actor: instructionActor(req)
    }));
  } catch (err) {
    sendInstructionError(err, res, next);
  }
});

// The saved revisions for one assistant, newest first. ?botType=support|sales.
router.get('/instructions/versions', async (req, res, next) => {
  try {
    res.json({ versions: await instructions.listVersions(req.tenant, req.query.botType || 'support') });
  } catch (err) {
    sendInstructionError(err, res, next);
  }
});

// body { botType, versionId } — restore a previous revision as a new version.
router.post('/instructions/restore', async (req, res, next) => {
  if (!req.body || !req.body.versionId) return res.status(400).json({ error: 'versionId is required' });
  try {
    res.json(await instructions.restoreVersion(req.tenant, req.body?.botType, req.body.versionId, { actor: instructionActor(req) }));
  } catch (err) {
    sendInstructionError(err, res, next);
  }
});

router.post('/faqs/regenerate', async (req, res) => {
  if (isFaqGenerationRunning(req.tenant.id)) return res.status(202).json({ status: 'pending' });
  if (!(await prisma.tenantDocument.count({ where: { tenantId: req.tenant.id } }))) {
    return res.status(409).json({ error: 'Add a document or import a website first — questions are written from your content.' });
  }
  if (await isFaqRegenLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'Suggested questions were refreshed several times recently. Please try again in an hour.' });
  }
  scheduleFaqGeneration(req.tenant.id);
  res.status(202).json({ status: 'pending' });
});

// ── Readiness audit and the Sales / Support knowledge split.

// Runs the pre-flight audit on this tenant's documents now and saves it
// (services/botAuditor.js). Synchronous — the caller is waiting on the report.
router.post('/preflight-audit', async (req, res) => {
  if (!(await prisma.tenantDocument.count({ where: { tenantId: req.tenant.id } }))) {
    return res.status(409).json({ error: 'Add a document or import a website first — the audit reads your content.' });
  }
  if (await isAuditLimited(req.tenant.id)) {
    return res.status(429).json({ error: 'The readiness audit ran several times recently. Please try again in an hour.' });
  }
  res.json(await auditTenant(req.tenant.id));
});

// The latest saved report; stale = documents changed since it was written.
router.get('/readiness', async (req, res) => {
  res.json(await tenantReadiness(req.tenant.id));
});

// Mark gap items "Optional / Not applicable" (or clear them) and recompute the
// saved report's scores — pure, no AI call. The dismissed pillars drop from each
// bot's weighted score, so the readiness % rises instantly and survives reloads.
router.patch('/readiness/ignored', async (req, res) => {
  const ignored = Array.isArray(req.body?.ignoredRequirements)
    ? [...new Set(req.body.ignoredRequirements.map((v) => String(v || '').trim()).filter((v) => v && v.length <= 100))].slice(0, 50)
    : [];
  const tenant = await prisma.tenant.findUnique({ where: { id: req.tenant.id }, select: { readinessReport: true } });
  const report = tenant?.readinessReport;
  if (!report || !report.bots) {
    return res.status(409).json({ error: 'Run a training check first — there is no report to adjust yet.' });
  }
  const updated = recomputeReadiness(report, ignored);
  await saveTenantReadiness(req.tenant.id, updated);
  res.json(updated);
});

// How the knowledge splits between the bots, overall and per document:
// sections each bot can use (support / sales / both), from the same
// classifier retrieval uses (domains/tenantProfile.js documentChunks).
router.get('/knowledge/distribution', async (req, res) => {
  const docs = await prisma.tenantDocument.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, content: true, category: true, botScope: true }
  });
  const botPreference = req.tenant.botPreference || 'both';
  const perDoc = docs.map((doc) => {
    const chunks = documentChunks(doc);
    return {
      id: doc.id, title: doc.title, category: doc.category, botScope: doc.botScope,
      sections: chunks.map((c) => ({ title: c.title, scope: c.scope })),
      counts: scopeCounts(chunks, botPreference)
    };
  });
  res.json({ botPreference, totals: scopeCounts(perDoc.flatMap((d) => d.sections), botPreference), documents: perDoc });
});

// Which bots this company deploys: { botPreference: 'support' | 'sales' | 'both' }.
// Changes what each bot may answer from (one bot alone uses all the
// knowledge) and what the readiness audit judges, so cached answers are
// dropped and the saved report shows as stale until re-run.
router.patch('/bot-preference', async (req, res) => {
  const botPreference = parseBotPreference(req.body?.botPreference, null);
  if (!botPreference.ok || !botPreference.value) return res.status(400).json({ error: botPreference.error || 'botPreference is required' });
  const updated = await prisma.tenant.update({
    where: { id: req.tenant.id }, data: { botPreference: botPreference.value }, select: { botPreference: true }
  });
  await answerCache.invalidateTenant(req.tenant.id);
  res.json(updated);
});

// ── Guardrails settings (scaffold). The single owner-tunable config row; absent
// returns platform defaults. services/guardrails.js owns validation. Tenant
// scoping + RBAC are inherited from this router's mounts (requireClient /
// requireOperator + loadTenantFromParam), so a client only ever sees its own.
router.get('/guardrails', async (req, res) => {
  res.json(await getGuardrails(req.tenant.id));
});

router.patch('/guardrails', async (req, res) => {
  const parsed = parseGuardrailsInput(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  res.json(await saveGuardrails(req.tenant.id, parsed.data));
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

// Has the embed widget actually loaded on the customer's site yet? The widget
// pings POST /api/v1/tenant-chat/:slug/ping on load, stamping widgetSeenAt on the
// key it used. We report the most recently seen live key so the dashboard can
// flip from "waiting" to "widget detected" without the owner sending a test chat.
router.get('/install-status', async (req, res) => {
  const seen = await prisma.tenantApiKey.findFirst({
    where: { tenantId: req.tenant.id, revokedAt: null, widgetSeenAt: { not: null } },
    orderBy: { widgetSeenAt: 'desc' },
    select: { keyPrefix: true, widgetSeenAt: true, widgetUrl: true }
  });
  res.json({
    installed: !!seen,
    seenAt: seen?.widgetSeenAt || null,
    url: seen?.widgetUrl || null,
    keyPrefix: seen?.keyPrefix || null
  });
});

// body { allowedOrigins: ["https://www.acme.com", …] } — the websites allowed
// to use this key from a browser (utils/tenantApiKeys.js); [] allows any.
router.patch('/api-keys/:keyId', async (req, res) => {
  const parsed = normalizeAllowedOrigins(req.body?.allowedOrigins);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const key = await prisma.tenantApiKey.findFirst({ where: { id: req.params.keyId, tenantId: req.tenant.id } });
  if (!key) return res.status(404).json({ error: 'API key not found' });
  if (key.revokedAt) return res.status(409).json({ error: 'That key is revoked — issue a new key instead.' });
  res.json(await prisma.tenantApiKey.update({
    where: { id: key.id },
    data: { allowedOrigins: parsed.origins },
    select: API_KEY_PUBLIC_FIELDS
  }));
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

// Voice input for the dashboard sandbox: transcribe an audio blob (Groq Whisper)
// and return { text, language } so the composer populates the input and the bot
// replies in the spoken language. Same service as the public widget endpoint,
// JWT-scoped to req.tenant here. Billable, so rate-limited per tenant.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } });
const isWsTranscribeLimited = createIpRateLimiter({ name: 'workspace-transcribe', max: 60, windowMs: 10 * 60 * 1000 });
router.post('/transcribe', (req, res, next) => audioUpload.single('audio')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `Audio must be ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB or smaller` : 'Upload one audio file in a field named "audio"'
    });
  }
  return next(err);
}), async (req, res, next) => {
  if (!isSttConfigured()) return res.status(503).json({ error: 'Voice input is not available right now.' });
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Attach an audio file in a field named "audio"' });
  if (await isWsTranscribeLimited(req.tenant.id)) return res.status(429).json({ error: 'Too many voice messages. Please wait a few minutes and try again.' });
  try {
    const { text } = await transcribeAudio({ buffer: req.file.buffer, filename: req.file.originalname || 'audio.webm', mimeType: req.file.mimetype || 'audio/webm' });
    res.json({ text, language: detectLanguage(text) || 'en' });
  } catch (err) {
    if (err.statusCode === 503) return res.status(503).json({ error: 'Voice input is not available right now.' });
    if (err.statusCode) return res.status(502).json({ error: 'Could not transcribe the audio. Please try again.' });
    next(err);
  }
});

// Speech-to-Speech in the dashboard test chat. Same orchestration as the public
// widget route, but JWT-scoped and sandboxed: req.actor is set here, so
// runVoiceChat → runTenantChat runs with sandbox=true and writes no live
// session, lead or usage. Guardrails are not applied to the owner's own test.
router.post('/voice-chat', (req, res, next) => audioUpload.single('audio')(req, res, (err) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? `Audio must be ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))}MB or smaller` : 'Upload one audio file in a field named "audio"'
    });
  }
  return next(err);
}), async (req, res, next) => {
  if (!isS2sConfigured()) return res.status(503).json({ error: 'Voice conversations are not available right now.' });
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Attach an audio file in a field named "audio"' });
  if (await isWsTranscribeLimited(req.tenant.id)) return res.status(429).json({ error: 'Too many voice messages. Please wait a few minutes and try again.' });
  try {
    const out = await runVoiceChat({
      tenant: req.tenant,
      audio: { buffer: req.file.buffer, filename: req.file.originalname || 'voice.webm', mimeType: req.file.mimetype || 'audio/webm' },
      body: req.body,
      sandbox: !!req.actor // the dashboard test chat: leave no trace
    });
    res.json(out);
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Tickets and usage

router.get('/tickets', async (req, res) => {
  res.json(await prisma.supportTicket.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, query: true, confidence: true, kind: true, botType: true, contactEmail: true, status: true, createdAt: true }
  }));
});

// Thrown inside the answer transaction when the ticket was no longer open by the
// time we claimed it (a concurrent answer won the race) — rolls the transaction
// back and maps to 409, so no duplicate document is created.
class TicketNotOpen extends Error {}

// "Add the answer": the last mile of the feedback loop. Turn an unanswered
// ticket into a published knowledge document and mark the ticket resolved, in
// one transaction — ticket → FAQ document → ticket 'answered'. Afterwards the
// RAG cache is cleared (so the very next chat can use the new answer) and a
// readiness re-audit is scheduled, exactly like any other knowledge change.
//
// The document and the ticket update commit together or not at all; the cache
// and audit side effects run only after that commit (same ordering as /scrape
// and the signup /complete). Scoped to req.tenant.id, so one tenant can never
// answer — or even see — another tenant's ticket.
router.post('/tickets/:id/answer', async (req, res) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    select: { id: true, query: true, status: true }
  });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  // Only an open ticket can be answered — re-answering a resolved one would add
  // a duplicate document, so guide the caller to the Documents page instead.
  if (ticket.status !== 'open') return res.status(409).json({ error: 'This ticket has already been answered.' });

  const content = String(req.body?.answer || '').trim().slice(0, MAX_CONTENT_LEN);
  if (!content) return res.status(400).json({ error: 'answer is required' });
  // Defaults to the FAQ category — the natural home for a one-off answered
  // question — but the caller may file it under any valid category.
  const category = parseCategory(req.body?.category || 'FAQ');
  if (!category.ok) return res.status(400).json({ error: category.error });
  const botScope = parseBotScope(req.body?.botScope);
  if (!botScope.ok) return res.status(400).json({ error: botScope.error });
  if (!(await roomForDocuments(req.tenant.id, 1))) return res.status(409).json(TOO_MANY_DOCS);

  // The visitor's question becomes the document title, so the new FAQ reads as
  // "Q → A"; fall back to a generic title if the ticket somehow has no query.
  const title = (ticket.query || 'Answer').trim().slice(0, MAX_TITLE_LEN) || 'Answer';

  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      // Claim the ticket atomically: flip it to answered ONLY if it's still open.
      // Under concurrent double-submits (two tabs, a retry, a fast double-click)
      // exactly one request gets count 1; the others get 0 and abort here, so a
      // single ticket never yields two FAQ documents.
      const claimed = await tx.supportTicket.updateMany({
        where: { id: ticket.id, tenantId: req.tenant.id, status: 'open' },
        data: { status: 'answered' }
      });
      if (claimed.count === 0) throw new TicketNotOpen();
      return tx.tenantDocument.create({
        data: { tenantId: req.tenant.id, title, content, category: category.value, botScope: botScope.value },
        select: DOC_FIELDS
      });
    });
  } catch (err) {
    if (err instanceof TicketNotOpen) return res.status(409).json({ error: 'This ticket has already been answered.' });
    throw err;
  }

  // Best-effort: the document + status change are already committed, so a cache or
  // readiness hiccup must not turn a successful answer into a 500.
  await invalidateTenantKnowledge(req.tenant.id)
    .catch((err) => logger.warn(`[workspace] tenant ${req.tenant.id}: cache invalidation after answer failed: ${err.message}`));
  scheduleTenantAudit(req.tenant.id); // knowledge changed → refresh readiness in the background
  res.status(201).json({ ticket: { id: ticket.id, status: 'answered' }, document });
});

// ── Leads: visitors who left an email in a chat, with the conversation and
// its AI summary (services/leads.js). A Lead row only exists once an email
// was captured and saved (email is NOT NULL), so every row here is a real
// lead — a conversation without an email never appears.
//
// GET /leads?botType=sales|support&status=NEW|CONTACTED (either omitted or
// "all" = no filter). Filters run in the database, so the 200-row page is
// the newest 200 MATCHING leads. counts covers all of this tenant's leads,
// unfiltered, for the filter labels.
const LEAD_STATUSES = ['NEW', 'CONTACTED'];
const LEAD_BOT_TYPES = ['sales', 'support'];
const MAX_LEADS = 200;
const LEAD_FIELDS = {
  id: true, botType: true, sessionId: true, email: true, chatSummary: true, summaryStatus: true, fullTranscript: true,
  status: true, confirmationSentAt: true, createdAt: true, updatedAt: true
};

// undefined/"all" -> no filter; a known value -> that value; anything else -> error.
function leadFilter(raw, allowed, normalize) {
  if (raw === undefined || raw === '' || String(raw).toLowerCase() === 'all') return { ok: true, value: undefined };
  const value = normalize(String(raw).trim());
  return allowed.includes(value) ? { ok: true, value } : { ok: false };
}

router.get('/leads', async (req, res) => {
  const botType = leadFilter(req.query.botType, LEAD_BOT_TYPES, (v) => v.toLowerCase());
  if (!botType.ok) return res.status(400).json({ error: `botType must be one of: all, ${LEAD_BOT_TYPES.join(', ')}` });
  const status = leadFilter(req.query.status, LEAD_STATUSES, (v) => v.toUpperCase());
  if (!status.ok) return res.status(400).json({ error: `status must be one of: all, ${LEAD_STATUSES.join(', ')}` });

  const where = { tenantId: req.tenant.id };
  if (botType.value) where.botType = botType.value;
  if (status.value) where.status = status.value;

  const [leads, groups] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: MAX_LEADS, select: LEAD_FIELDS }),
    prisma.lead.groupBy({ by: ['botType', 'status'], where: { tenantId: req.tenant.id }, _count: { _all: true } })
  ]);
  const counts = { total: 0, sales: 0, support: 0, NEW: 0, CONTACTED: 0 };
  for (const g of groups) {
    const n = g._count._all;
    counts.total += n;
    if (g.botType in counts) counts[g.botType] += n;
    if (g.status in counts) counts[g.status] += n;
  }
  res.json({ leads, counts, filters: { botType: botType.value || 'all', status: status.value || 'all' } });
});

// Body: { status: 'NEW' | 'CONTACTED' }
router.patch('/leads/:leadId', async (req, res) => {
  const status = String(req.body?.status || '').toUpperCase();
  if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${LEAD_STATUSES.join(', ')}` });
  const lead = await prisma.lead.findFirst({ where: { id: req.params.leadId, tenantId: req.tenant.id }, select: { id: true } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  res.json(await prisma.lead.update({ where: { id: lead.id }, data: { status }, select: LEAD_FIELDS }));
});

// ── Sessions: every conversation with its AI summary (services/chatSessions.js),
// newest activity first, for the Sessions view of Leads & Summaries.
//
// GET /sessions?botType=all|sales|support&cursor=<session id> — 30 per page;
// nextCursor is null on the last page. Each row carries the leads captured in
// it (id, email, status), so staff can mark them contacted from the list.
const SESSIONS_PAGE = 30;
const SESSION_FIELDS = {
  id: true, externalUserId: true, botType: true, startedAt: true, lastMessageAt: true, messageCount: true,
  endedAt: true, summary: true, summaryStatus: true, summarizedAt: true, pausedAt: true, pauseReason: true
};
const isSummarizeLimited = createIpRateLimiter({ name: 'workspace-summarize', max: 20, windowMs: 60 * 60 * 1000 });

async function leadsBySession(tenantId, sessionIds) {
  if (!sessionIds.length) return new Map();
  const rows = await prisma.lead.findMany({
    where: { tenantId, sessionId: { in: sessionIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, sessionId: true, email: true, status: true, botType: true }
  });
  const map = new Map();
  for (const { sessionId, ...lead } of rows) map.set(sessionId, [...(map.get(sessionId) || []), lead]);
  return map;
}

// Which of these sessions were escalated (have a SupportTicket), for the Chat
// Logs "escalated" badge and the CSV column. SupportTicket.sessionId isn't a
// relation, so this is a separate tenant-scoped lookup, like leadsBySession.
async function ticketsBySession(tenantId, sessionIds) {
  if (!sessionIds.length) return new Map();
  const rows = await prisma.supportTicket.findMany({
    where: { tenantId, sessionId: { in: sessionIds } },
    select: { sessionId: true, kind: true, helpdeskProvider: true, helpdeskTicketId: true }
  });
  const map = new Map();
  for (const t of rows) {
    const cur = map.get(t.sessionId) || { count: 0, kinds: new Set(), helpdeskSynced: false };
    cur.count += 1;
    if (t.kind) cur.kinds.add(t.kind);
    if (t.helpdeskTicketId) cur.helpdeskSynced = true;
    map.set(t.sessionId, cur);
  }
  return map;
}

// Which of these sessions contain at least one voice (Speech-to-Speech) turn, for
// the Chat Logs "Voice" badge and CSV column (Feature 4). sessionIds are already
// tenant-scoped (they came from a tenant-scoped session query), so filtering
// ChatMessage by them alone is safe.
async function voiceBySession(sessionIds) {
  if (!sessionIds.length) return new Set();
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId: { in: sessionIds }, source: 'voice' },
    distinct: ['sessionId'], select: { sessionId: true }
  });
  return new Set(rows.map((r) => r.sessionId));
}

// Advanced Chat Logs filters (Feature 16). Parses the shared query params into a
// Prisma where-clause, 400-ing on a bad value. `escalated` can't be expressed as
// a plain column (no relation), so it's returned separately and applied by the
// caller once the escalated-session id set is known.
const SESSION_STATUSES = ['active', 'paused'];
const SESSION_ESCALATED = ['yes', 'no'];
const MAX_SEARCH_LEN = 200;

function parseDateParam(raw) {
  if (raw === undefined || raw === '') return { ok: true, value: undefined };
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d };
}

function parseSessionFilters(req) {
  const botType = leadFilter(req.query.botType, LEAD_BOT_TYPES, (v) => v.toLowerCase());
  if (!botType.ok) return { ok: false, error: `botType must be one of: all, ${LEAD_BOT_TYPES.join(', ')}` };
  const status = leadFilter(req.query.status, SESSION_STATUSES, (v) => v.toLowerCase());
  if (!status.ok) return { ok: false, error: `status must be one of: all, ${SESSION_STATUSES.join(', ')}` };
  const escalated = leadFilter(req.query.escalated, SESSION_ESCALATED, (v) => v.toLowerCase());
  if (!escalated.ok) return { ok: false, error: `escalated must be one of: all, ${SESSION_ESCALATED.join(', ')}` };
  const from = parseDateParam(req.query.from);
  if (!from.ok) return { ok: false, error: 'from must be a valid date' };
  const to = parseDateParam(req.query.to);
  if (!to.ok) return { ok: false, error: 'to must be a valid date' };
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, MAX_SEARCH_LEN) : '';

  const where = { tenantId: req.tenant.id, messageCount: { gt: 0 } };
  if (botType.value) where.botType = botType.value;
  if (status.value === 'paused') where.pausedAt = { not: null };
  if (status.value === 'active') where.pausedAt = null;
  if (from.value || to.value) {
    where.lastMessageAt = { ...(from.value ? { gte: from.value } : {}), ...(to.value ? { lte: to.value } : {}) };
  }
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: 'insensitive' } },
      { externalUserId: { contains: q, mode: 'insensitive' } },
      { messages: { some: { content: { contains: q, mode: 'insensitive' } } } }
    ];
  }
  return {
    ok: true, where, escalated: escalated.value,
    filters: {
      botType: botType.value || 'all', status: status.value || 'all',
      escalated: escalated.value || 'all', q, from: from.value?.toISOString() || null, to: to.value?.toISOString() || null
    }
  };
}

// Narrow a where-clause to (or away from) the tenant's escalated sessions. The
// set is bounded (take EXPORT_MAX) — far more than a dashboard would scroll.
const EXPORT_MAX = 5000;
async function applyEscalatedFilter(where, tenantId, escalated) {
  if (!escalated) return where;
  const rows = await prisma.supportTicket.findMany({
    where: { tenantId, sessionId: { not: null } }, distinct: ['sessionId'], select: { sessionId: true }, take: EXPORT_MAX
  });
  const ids = rows.map((r) => r.sessionId);
  // escalated=yes with no escalated sessions must match nothing, not everything.
  if (escalated === 'yes') return { ...where, id: ids.length ? { in: ids } : { in: ['__none__'] } };
  return ids.length ? { ...where, id: { notIn: ids } } : where;
}

// Send a CSV download. A BOM makes Excel read UTF-8 (Hindi) correctly; the
// filename is ASCII-sanitised so it can't break the Content-Disposition header.
function sendCsv(res, filename, csv) {
  const safe = String(filename).replace(/[^\w.-]+/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.send(BOM + csv);
}

router.get('/sessions', async (req, res) => {
  const parsed = parseSessionFilters(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;

  const where = await applyEscalatedFilter(parsed.where, req.tenant.id, parsed.escalated);
  const rows = await prisma.chatSession.findMany({
    where,
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: SESSIONS_PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: SESSION_FIELDS
  });
  const page = rows.slice(0, SESSIONS_PAGE);
  const ids = page.map((s) => s.id);
  const [leads, tickets, voice] = await Promise.all([
    leadsBySession(req.tenant.id, ids), ticketsBySession(req.tenant.id, ids), voiceBySession(ids)
  ]);
  res.json({
    filters: parsed.filters,
    sessions: page.map((s) => {
      const t = tickets.get(s.id);
      return {
        ...s, leads: leads.get(s.id) || [],
        escalated: !!t, ticketCount: t?.count || 0,
        ticketKinds: t ? [...t.kinds] : [], helpdeskSynced: !!t?.helpdeskSynced,
        hasVoice: voice.has(s.id)
      };
    }),
    nextCursor: rows.length > SESSIONS_PAGE ? page.at(-1).id : null
  });
});

// CSV export of the filtered conversations (Feature 16). Same filters as the
// list, no pagination (capped at EXPORT_MAX), tenant-scoped. Cells are escaped
// against CSV/formula injection (services/shared/csvExport.js).
router.get('/sessions/export.csv', async (req, res) => {
  const parsed = parseSessionFilters(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const where = await applyEscalatedFilter(parsed.where, req.tenant.id, parsed.escalated);
  const rows = await prisma.chatSession.findMany({
    where, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], take: EXPORT_MAX, select: SESSION_FIELDS
  });
  const ids = rows.map((s) => s.id);
  const [leads, tickets, voice] = await Promise.all([
    leadsBySession(req.tenant.id, ids), ticketsBySession(req.tenant.id, ids), voiceBySession(ids)
  ]);
  const headers = ['Session ID', 'Started', 'Last message', 'Bot', 'Messages', 'Status', 'Escalated', 'Helpdesk', 'Voice', 'Visitor', 'Lead emails', 'Summary'];
  const data = rows.map((s) => {
    const t = tickets.get(s.id);
    const emails = (leads.get(s.id) || []).map((l) => l.email).filter(Boolean).join('; ');
    return [
      s.id,
      s.startedAt ? new Date(s.startedAt).toISOString() : '',
      s.lastMessageAt ? new Date(s.lastMessageAt).toISOString() : '',
      s.botType || '',
      s.messageCount ?? 0,
      s.pausedAt ? 'paused' : 'active',
      t ? 'yes' : 'no',
      t?.helpdeskSynced ? 'synced' : '',
      voice.has(s.id) ? 'yes' : '',
      s.externalUserId || '',
      emails,
      s.summary || ''
    ];
  });
  sendCsv(res, `chat-logs-${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(headers, data));
});

// One conversation: its summary, leads and every message, oldest first.
// confidence is included: it's this tenant's own review data.
router.get('/sessions/:sessionId', async (req, res) => {
  const session = await prisma.chatSession.findFirst({
    where: { id: req.params.sessionId, tenantId: req.tenant.id }, select: SESSION_FIELDS
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const [messages, leads] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: CHRONOLOGICAL,
      take: 500,
      select: { id: true, role: true, content: true, botType: true, confidence: true, answered: true, imageKeys: true, source: true, createdAt: true }
    }),
    leadsBySession(req.tenant.id, [session.id])
  ]);
  // tenantId lets the client build scoped chat-image URLs for the transcript.
  // hasVoice drives the "Voice" badge in the drawer header (Feature 4); the
  // per-message tags come from each message's own source.
  const hasVoice = messages.some((m) => m.source === 'voice');
  res.json({ ...session, tenantId: req.tenant.id, hasVoice, leads: leads.get(session.id) || [], messages });
});

// CSV export of a single conversation's transcript (Feature 16). Tenant-scoped;
// another tenant's session id reads as a missing one.
router.get('/sessions/:sessionId/export.csv', async (req, res) => {
  const session = await prisma.chatSession.findFirst({
    where: { id: req.params.sessionId, tenantId: req.tenant.id }, select: { id: true }
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: session.id }, orderBy: CHRONOLOGICAL, take: 2000,
    select: { role: true, content: true, botType: true, confidence: true, answered: true, source: true, createdAt: true }
  });
  const headers = ['Time', 'Role', 'Bot', 'Source', 'Confidence', 'Answered', 'Message'];
  const data = messages.map((m) => [
    m.createdAt ? new Date(m.createdAt).toISOString() : '',
    m.role, m.botType || '', m.source === 'voice' ? 'voice' : 'text',
    m.confidence ?? '', m.answered == null ? '' : (m.answered ? 'yes' : 'no'), m.content || ''
  ]);
  sendCsv(res, `conversation-${session.id}.csv`, rowsToCsv(headers, data));
});

// ── Improvements: conversations with genuine misses — each weak reply and
// the question that led to it, the gaps to fill in the documents. A reply is
// weak when it went through retrieval (confidence is set; greetings and
// handoff actions have none) and either
//   - its confidence is below IMPROVEMENT_CONFIDENCE_BELOW (25%), or
//   - the bot gave no knowledge-base answer (answered false): the gate's
//     fallback, a handoff, or "rephrase that" — whatever its score.
// Not a higher cut-off: engine/confidence.js scores ordinary, correct answers
// at 33-50%, so e.g. 60% would list nearly every good answer. Both bots
// unless botType is given; most recent weak reply first.
//
// GET /improvements?botType=all|sales|support&page=0 — 20 sessions per page.
const IMPROVEMENTS_PAGE = 20;
const MAX_WEAK_ANSWERS = 10; // per session, most recent kept
const improvementBelow = () => {
  const n = Number(process.env.IMPROVEMENT_CONFIDENCE_BELOW);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.25;
};
const isWeak = (m, below) => m.confidence != null && (m.confidence < below || !m.answered);
// createMany writes a turn's two rows with the same timestamp: on a tie the
// visitor's message ('user') goes before the reply ('assistant').
const CHRONOLOGICAL = [{ createdAt: 'asc' }, { role: 'desc' }];

router.get('/improvements', async (req, res) => {
  const botType = leadFilter(req.query.botType, LEAD_BOT_TYPES, (v) => v.toLowerCase());
  if (!botType.ok) return res.status(400).json({ error: `botType must be one of: all, ${LEAD_BOT_TYPES.join(', ')}` });
  const page = Math.min(500, Math.max(0, Number.parseInt(req.query.page, 10) || 0));
  const below = improvementBelow();

  const groups = await prisma.$queryRaw`
    WITH low AS (
      SELECT m."sessionId" AS id, MIN(m.confidence)::float AS lowest, COUNT(*)::int AS "weakAnswers",
             MAX(m."createdAt") AS "lastWeakAt"
      FROM "ChatMessage" m JOIN "ChatSession" s ON s.id = m."sessionId"
      WHERE s."tenantId" = ${req.tenant.id} AND m.role = 'assistant'
        AND m.confidence IS NOT NULL AND (m.confidence < ${below} OR NOT m.answered)
        ${botType.value ? Prisma.sql`AND m."botType" = ${botType.value}` : Prisma.empty}
      GROUP BY m."sessionId"
    )
    SELECT id, lowest, "weakAnswers", "lastWeakAt",
           COUNT(*) OVER ()::int AS "totalSessions", SUM("weakAnswers") OVER ()::int AS "totalWeakAnswers"
    FROM low ORDER BY "lastWeakAt" DESC, id
    LIMIT ${IMPROVEMENTS_PAGE} OFFSET ${page * IMPROVEMENTS_PAGE}`;

  const ids = groups.map((g) => g.id);
  const [sessions, messages, leads] = ids.length ? await Promise.all([
    prisma.chatSession.findMany({ where: { id: { in: ids }, tenantId: req.tenant.id }, select: SESSION_FIELDS }),
    prisma.chatMessage.findMany({
      where: { sessionId: { in: ids } }, orderBy: CHRONOLOGICAL,
      select: { id: true, sessionId: true, role: true, content: true, botType: true, confidence: true, answered: true, createdAt: true }
    }),
    leadsBySession(req.tenant.id, ids)
  ]) : [[], [], new Map()];

  // Each weak reply, paired with the visitor message just before it.
  const weakBySession = new Map();
  const lastQuestion = new Map();
  for (const m of messages) {
    if (m.role === 'user') { lastQuestion.set(m.sessionId, m.content); continue; }
    if (!isWeak(m, below)) continue;
    if (botType.value && m.botType !== botType.value) continue;
    const list = weakBySession.get(m.sessionId) || [];
    list.push({
      id: m.id, question: lastQuestion.get(m.sessionId) || null, answer: m.content, confidence: m.confidence,
      botType: m.botType, answered: m.answered, at: m.createdAt
    });
    weakBySession.set(m.sessionId, list.slice(-MAX_WEAK_ANSWERS));
  }

  const byId = new Map(sessions.map((s) => [s.id, s]));
  res.json({
    below,
    totalSessions: groups[0]?.totalSessions ?? 0,
    totalWeakAnswers: groups[0]?.totalWeakAnswers ?? 0,
    sessions: groups.filter((g) => byId.has(g.id)).map((g) => ({
      ...byId.get(g.id), lowest: g.lowest, weakAnswers: g.weakAnswers, lastWeakAt: g.lastWeakAt,
      leads: leads.get(g.id) || [], weak: weakBySession.get(g.id) || []
    })),
    nextPage: (page + 1) * IMPROVEMENTS_PAGE < (groups[0]?.totalSessions ?? 0) ? page + 1 : null
  });
});

// Write (or rewrite) the summary now. Each one is an LLM call billed to the tenant.
router.post('/sessions/:sessionId/summarize', async (req, res) => {
  const session = await prisma.chatSession.findFirst({ where: { id: req.params.sessionId, tenantId: req.tenant.id }, select: { id: true } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (await isSummarizeLimited(req.tenant.id)) return res.status(429).json({ error: 'Too many summary requests. Try again later.' });
  // force: someone clicked "Rewrite" and is waiting for a new summary, so this
  // takes the claim even if a background sweep holds a live lease on it
  // (services/chatSessions.js).
  await claimSession(session.id, { force: true });
  runSessionSummary(session.id);
  res.status(202).json({ id: session.id, summaryStatus: 'pending' });
});

// Pause / resume a conversation from Chat Logs. A paused conversation gets no
// bot replies (services/tenantChat.js) until it is resumed. Pausing here is a
// human action (pauseReason 'manual'); spam auto-pause sets 'spam' on its own.
// Both are idempotent and tenant-scoped.
router.patch('/sessions/:sessionId/pause', async (req, res) => {
  const session = await prisma.chatSession.findFirst({ where: { id: req.params.sessionId, tenantId: req.tenant.id }, select: { id: true } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(await prisma.chatSession.update({ where: { id: session.id }, data: { pausedAt: new Date(), pauseReason: 'manual' }, select: SESSION_FIELDS }));
});

router.patch('/sessions/:sessionId/resume', async (req, res) => {
  const session = await prisma.chatSession.findFirst({ where: { id: req.params.sessionId, tenantId: req.tenant.id }, select: { id: true } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(await prisma.chatSession.update({ where: { id: session.id }, data: { pausedAt: null, pauseReason: null }, select: SESSION_FIELDS }));
});

// ── Human Escalation (Feature 5, services/escalation.js): per-tenant trigger
// keywords + business hours + reply ETA. GET returns the settings; PUT upserts
// them (validated).
router.get('/escalation', async (req, res) => {
  res.json(await escalationSvc.getEscalationSettings(req.tenant.id));
});

router.put('/escalation', async (req, res, next) => {
  try {
    res.json(await escalationSvc.updateEscalationSettings(req.tenant.id, req.body || {}));
  } catch (err) {
    if (err instanceof escalationSvc.EscalationError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Helpdesk integration (Feature 5, services/helpdesk): connect Zoho Desk or
// Freshdesk so an escalation opens a real ticket there. Credentials go in
// encrypted and are never returned; status shows the recent push log.
router.get('/helpdesk', async (req, res) => {
  res.json(await helpdeskSettings.getHelpdeskStatus(req.tenant.id));
});

router.post('/helpdesk/connect', async (req, res, next) => {
  try {
    res.json(await helpdeskSettings.connectHelpdesk(req.tenant.id, req.body || {}));
  } catch (err) {
    if (err instanceof helpdeskSettings.HelpdeskConfigError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// Toggle ticket mirroring on/off without disconnecting. Body: { isEnabled }.
router.patch('/helpdesk', async (req, res, next) => {
  try {
    res.json(await helpdeskSettings.setHelpdeskEnabled(req.tenant.id, !!req.body?.isEnabled));
  } catch (err) {
    if (err instanceof helpdeskSettings.HelpdeskConfigError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

router.post('/helpdesk/disconnect', async (req, res) => {
  res.json(await helpdeskSettings.disconnectHelpdesk(req.tenant.id));
});

// ── Chat-log retention (Feature 16, services/retention.js): a FIXED server
// policy (30 days) + a guarded purge. GET returns the fixed, read-only policy;
// there is no PUT — tenants cannot set a custom period. POST /purge runs a
// dry-run (default) or the real purge of conversations older than the window.
router.get('/retention', async (req, res) => {
  res.json(await retention.getRetentionSettings(req.tenant.id));
});

// Body: { dryRun?: boolean } — dryRun defaults to true, so the dashboard shows
// the count before anyone deletes anything. Pass { dryRun: false } to purge.
router.post('/retention/purge', async (req, res, next) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    res.json(await retention.purgeTenant(req.tenant.id, { dryRun }));
  } catch (err) {
    if (err instanceof retention.RetentionError) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

// ── Team alerts (services/teamAlerts.js): who gets "new lead" and "needs
// attention" emails. teamEmail null = the defaults; recipients is who
// actually gets them right now.
router.get('/notifications', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.tenant.id }, select: { id: true, teamEmail: true, signupEmail: true }
  });
  res.json({ teamEmail: tenant.teamEmail, recipients: await teamRecipients(tenant), lowConfidenceBelow: lowConfidenceBelow() });
});

// Body: { teamEmail: "a@x.com, b@x.com" | "" }
router.patch('/notifications', async (req, res) => {
  const parsed = parseTeamEmail(req.body?.teamEmail);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const tenant = await prisma.tenant.update({
    where: { id: req.tenant.id }, data: { teamEmail: parsed.value }, select: { id: true, teamEmail: true, signupEmail: true }
  });
  res.json({ teamEmail: tenant.teamEmail, recipients: await teamRecipients(tenant), lowConfidenceBelow: lowConfidenceBelow() });
});

// All-time totals plus the per-bot breakdown (services/usageStats.js):
// byBot.support / byBot.sales / byBot.other, each with questions, AI answers,
// cache hits, tokens, cost, cache savings and 7-day burn.
router.get('/usage', async (req, res) => {
  const [breakdownFor, conversations] = await Promise.all([
    usageBreakdowns([req.tenant.id]),
    prisma.chatSession.count({ where: { tenantId: req.tenant.id } })
  ]);
  const { totals, ...byBot } = breakdownFor(req.tenant.id);
  res.json({
    calls: totals.aiAnswers, // real LLM calls; cache hits are counted separately
    cacheHits: totals.cacheHits,
    cacheHitRate: totals.cacheHitRate,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    estimatedCostUsd: totals.costUsd,
    savedTokens: totals.savedTokens,
    savedCostUsd: totals.savedCostUsd,
    conversations,
    questions: totals.questions,
    byBot
  });
});

// GET /usage/daily?days=30 — one row per UTC day (7–90 days, oldest first),
// zero-filled so charts have no gaps: questions asked, conversations started,
// AI answers generated (real LLM calls), cache hits, tokens used, total
// cost (every bot plus platform work such as starter FAQs) and tickets
// filed — plus the answers, tokens and cost for each bot.
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
    u AS (SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day,
                 COUNT(*) FILTER (WHERE NOT "cacheHit")::int AS n,
                 COUNT(*) FILTER (WHERE "cacheHit")::int AS hits,
                 SUM("promptTokens" + "completionTokens")::int AS tokens,
                 COALESCE(SUM("estimatedCostUsd"), 0)::float AS cost,
                 COUNT(*) FILTER (WHERE NOT "cacheHit" AND "botType" = 'support')::int AS support_n,
                 COUNT(*) FILTER (WHERE NOT "cacheHit" AND "botType" = 'sales')::int AS sales_n,
                 COALESCE(SUM("promptTokens" + "completionTokens") FILTER (WHERE "botType" = 'support'), 0)::int AS support_tokens,
                 COALESCE(SUM("promptTokens" + "completionTokens") FILTER (WHERE "botType" = 'sales'), 0)::int AS sales_tokens,
                 COALESCE(SUM("estimatedCostUsd") FILTER (WHERE "botType" = 'support'), 0)::float AS support_cost,
                 COALESCE(SUM("estimatedCostUsd") FILTER (WHERE "botType" = 'sales'), 0)::float AS sales_cost
          FROM "UsageLog" WHERE "tenantId" = ${tenantId} GROUP BY 1),
    t AS (SELECT ("createdAt" AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS n
          FROM "SupportTicket" WHERE "tenantId" = ${tenantId} GROUP BY 1)
    SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
           COALESCE(q.n, 0) AS questions, COALESCE(c.n, 0) AS conversations,
           COALESCE(u.n, 0) AS "aiAnswers", COALESCE(u.hits, 0) AS "cacheHits",
           COALESCE(u.tokens, 0) AS tokens, COALESCE(u.cost, 0) AS "costUsd", COALESCE(t.n, 0) AS tickets,
           COALESCE(u.support_n, 0) AS "supportAnswers", COALESCE(u.sales_n, 0) AS "salesAnswers",
           COALESCE(u.support_tokens, 0) AS "supportTokens", COALESCE(u.sales_tokens, 0) AS "salesTokens",
           COALESCE(u.support_cost, 0) AS "supportCostUsd", COALESCE(u.sales_cost, 0) AS "salesCostUsd"
    FROM d LEFT JOIN q USING (day) LEFT JOIN c USING (day) LEFT JOIN u USING (day) LEFT JOIN t USING (day)
    ORDER BY d.day`;
  res.json({ days, series: rows });
});

// Wrapped here, not in app.js: this router is mounted inside other routers,
// and wrapRouterAsync only reaches a router's own routes, not nested ones.
module.exports = wrapRouterAsync(router);
module.exports.API_KEY_PUBLIC_FIELDS = API_KEY_PUBLIC_FIELDS;
