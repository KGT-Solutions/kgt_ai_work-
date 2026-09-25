const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const multer = require('multer');
const { crawlSite, CrawlerError } = require('../services/shared/crawler');
const { pdfToDocuments, PdfIngestError } = require('../services/shared/pdfIngest');
const { parseCategory, suggestCategory } = require('../services/shared/documentCategory');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { issueApiKey } = require('../utils/tenantApiKeys');

// Public self-serve registration wizard backend (apps/admin-web/pages/register.js).
// Deliberately unauthenticated — that's the entire point of self-serve — so
// everything here is IP-rate-limited and server-side capped instead of
// relying on a login. This is a materially different trust boundary from
// tenantAdmin.routes.js (super-admin only): anyone on the internet can call
// these two endpoints, so nothing here should assume good-faith input.
//
// Two-step split mirrors the wizard's own Step 2 (preview + edit) / Step 3
// (finalize) split: /analyze crawls (and /analyze-pdf parses an uploaded
// PDF) and returns pages WITHOUT creating
// anything (no tenant exists yet, so there's nothing to persist to or
// invalidate); /complete creates the Tenant + TenantDocument rows from
// whatever the visitor reviewed/edited in the browser — not a fresh crawl,
// so an edit made in Step 2 is exactly what gets trained on.
const router = express.Router();

const isAnalyzeRateLimited = createIpRateLimiter({ max: 8, windowMs: 10 * 60 * 1000 });
const isCompleteRateLimited = createIpRateLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
const isPdfRateLimited = createIpRateLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

// Room for a full crawl (crawler.js MAX_PAGES = 12) plus a multi-part PDF.
const MAX_PAGES_ON_COMPLETE = 25;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

// Memory storage, not disk: the PDF is parsed and discarded within the
// request — nothing is persisted until /complete, same as a crawl. The
// buffer is capped by MAX_PDF_BYTES, and the rate limiter runs BEFORE multer
// so a blocked caller can't make the server buffer 10MB first.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) => {
    // Some browsers/OSes send application/octet-stream for a .pdf; the
    // %PDF- magic-byte check in pdfToDocuments is the real gate.
    const looksPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    if (looksPdf) cb(null, true);
    else cb(new PdfIngestError('Only PDF files are accepted', 400));
  }
});

function pdfUploadMiddleware(req, res, next) {
  if (isPdfRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many uploads from this address. Please wait a few minutes and try again.' });
  }
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
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 20000; // per page — a hard ceiling regardless of what the client claims it sent

// The authorization a visitor must give before we crawl their site. The text
// the wizard shows (CRAWL_CONSENT_TEXT in apps/admin-web/pages/register.js)
// must match this one — when the wording changes, change both and bump the
// version, so every TenantConsent row records exactly what was agreed to.
const CRAWL_CONSENT_STATEMENT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and ' +
  'extract content from this domain.';
const CRAWL_CONSENT_VERSION = '2026-09-24';

const MAX_SOURCE_URL_LEN = 2048;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function makeSlug(name) {
  const base = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  // A random suffix, not just the company name, because this endpoint has
  // no auth to fall back on for a friendly "slug taken, try another" retry
  // loop — collisions must not be a public-facing self-serve dead end.
  return `${base || 'company'}-${crypto.randomBytes(3).toString('hex')}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

router.post('/analyze', async (req, res) => {
  if (isAnalyzeRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many analysis requests from this address. Please wait a few minutes and try again.' });
  }

  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  // Enforced here, not just by the wizard's checkbox: no crawl without it.
  // It's recorded permanently (TenantConsent) at /complete, once a tenant exists.
  if (req.body?.authorized !== true) {
    return res.status(400).json({ error: 'You must confirm you are authorized to let us crawl this domain' });
  }

  try {
    // Static-only on purpose: no browserFallback on this unauthenticated
    // route (see crawlerBrowser.js). A JS-only site's 422 here leads the
    // visitor to the PDF upload instead.
    const result = await crawlSite(url);
    res.json({
      baseHost: result.baseHost,
      crawled: result.crawled,
      skipped: result.skipped,
      // category is a suggestion for which wizard tab the page starts in;
      // the visitor can move it, and /complete saves whatever they chose.
      pages: result.pages.map((p) => ({
        title: p.title,
        content: p.markdown,
        url: p.url,
        category: suggestCategory({ title: p.title, url: p.url, markdown: p.markdown, source: 'crawl' })
      }))
    });
  } catch (e) {
    if (e instanceof CrawlerError) return res.status(e.statusCode).json({ error: e.message });
    throw e; // an unexpected failure — let the global error handler log and 500 it
  }
});

// Same response shape as /analyze (pages[].title/content/url), so the
// wizard merges uploaded-PDF pages into the same review list as crawled
// ones. url is null — a PDF has no page to link back to.
router.post('/analyze-pdf', pdfUploadMiddleware, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a PDF in a field named "file"' });

  try {
    const result = await pdfToDocuments(req.file.buffer, req.file.originalname);
    res.json({
      title: result.title,
      pdfPageCount: result.pdfPageCount,
      truncated: result.truncated,
      pages: result.pages.map((p) => ({
        title: p.title,
        content: p.markdown,
        url: null,
        category: suggestCategory({ title: p.title, markdown: p.markdown, source: 'pdf' })
      }))
    });
  } catch (e) {
    if (e instanceof PdfIngestError) return res.status(e.statusCode).json({ error: e.message });
    throw e;
  }
});

router.post('/complete', async (req, res) => {
  if (isCompleteRateLimited(req.ip)) {
    return res.status(429).json({
      error: 'Too many signup attempts from this address. Please try again later, or reach out to us directly.'
    });
  }

  const companyName = String(req.body?.companyName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const industryLabel = String(req.body?.industryLabel || '').trim();
  const rawPages = Array.isArray(req.body?.pages) ? req.body.pages : [];

  if (!companyName) return res.status(400).json({ error: 'companyName is required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid business email is required' });
  if (!industryLabel) return res.status(400).json({ error: 'industryLabel is required' });
  if (!rawPages.length) return res.status(400).json({ error: 'At least one reviewed page is required — run Analyze first' });

  const pages = [];
  for (const p of rawPages.slice(0, MAX_PAGES_ON_COMPLETE)) {
    // Omitted category -> CORE_OVERVIEW (older clients); an unknown value is
    // rejected outright rather than silently re-filed somewhere else.
    const category = parseCategory(p?.category);
    if (!category.ok) return res.status(400).json({ error: category.error });
    const sourceUrl = typeof p?.sourceUrl === 'string' && hostOf(p.sourceUrl) ? p.sourceUrl.slice(0, MAX_SOURCE_URL_LEN) : null;
    const page = {
      title: String(p?.title || '').trim().slice(0, MAX_TITLE_LEN),
      content: String(p?.content || '').trim().slice(0, MAX_CONTENT_LEN),
      category: category.value,
      sourceUrl
    };
    if (page.title && page.content) pages.push(page);
  }
  if (!pages.length) return res.status(400).json({ error: 'None of the submitted pages had both a title and content' });

  // Crawled content (pages carrying a sourceUrl) can only be saved alongside
  // the crawl authorization, which is recorded as a TenantConsent row.
  const consent = req.body?.websiteConsent;
  const consentHost = consent?.authorized === true ? hostOf(String(consent.url || '')) : null;
  if (pages.some((p) => p.sourceUrl) && !consentHost) {
    return res.status(400).json({ error: 'Crawled pages require websiteConsent: { authorized: true, url }' });
  }

  const { tenant, apiKey } = await prisma.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: { name: companyName, slug: makeSlug(companyName), industryLabel, signupEmail: email }
    });
    const { key } = await issueApiKey(tx, created.id);
    await tx.tenantDocument.createMany({
      data: pages.map((p) => ({ tenantId: created.id, ...p }))
    });
    if (consentHost) {
      await tx.tenantConsent.create({
        data: {
          tenantId: created.id,
          kind: 'WEBSITE_CRAWL',
          domain: consentHost,
          statement: CRAWL_CONSENT_STATEMENT,
          statementVersion: CRAWL_CONSENT_VERSION,
          email,
          ipAddress: req.ip || null,
          userAgent: String(req.headers['user-agent'] || '').slice(0, 512) || null
        }
      });
    }
    return { tenant: created, apiKey: key };
  });
  // No invalidateTenantKnowledge call needed — this tenant's knowledge
  // cache has never been populated, so there's nothing stale to clear.

  res.status(201).json({
    tenantId: tenant.id,
    slug: tenant.slug,
    apiKey,
    name: tenant.name,
    documentsCreated: pages.length
  });
});

module.exports = router;
