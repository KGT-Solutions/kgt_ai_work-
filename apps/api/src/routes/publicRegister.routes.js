const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const multer = require('multer');
const { crawlSite, CrawlerError } = require('../services/shared/crawler');
const { pdfToDocuments, PdfIngestError } = require('../services/shared/pdfIngest');
const { parseCategory, suggestCategory } = require('../services/shared/documentCategory');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { issueApiKey } = require('../utils/tenantApiKeys');
const { hashPassword } = require('../utils/password');
const { signClientToken } = require('../middleware/clientAuth');
const { crawlConsentRecord, hostOf } = require('../services/shared/crawlConsent');
const { scheduleFaqGeneration } = require('../services/tenantFaqs');

// Public self-serve registration wizard backend (apps/admin-web/pages/register.js).
// Deliberately unauthenticated — that's the entire point of self-serve — so
// everything here is IP-rate-limited and server-side capped instead of
// relying on a login. This is a materially different trust boundary from
// tenantAdmin.routes.js (operators only): anyone on the internet can call
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
// Signups per IP per hour. Every attempt counts, including rejected ones, so
// the endpoint can't be used to probe which emails already have accounts.
const isCompleteRateLimited = createIpRateLimiter({ max: Number(process.env.SIGNUP_RATE_LIMIT_MAX) || 3, windowMs: 60 * 60 * 1000 });
const isPdfRateLimited = createIpRateLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

// Room for a full crawl (crawler.js MAX_PAGES = 12) plus several uploaded
// documents: the wizard lets a company combine both sources.
const MAX_PAGES_ON_COMPLETE = 40;
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

const MAX_SOURCE_URL_LEN = 2048;
const MIN_PASSWORD_LEN = 10;

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

  const companyName = String(req.body?.companyName || '').trim().slice(0, 120);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const contactName = String(req.body?.contactName || '').trim().slice(0, 120) || null;
  const industryLabel = String(req.body?.industryLabel || '').trim().slice(0, 120);
  const rawPages = Array.isArray(req.body?.pages) ? req.body.pages : [];

  if (!companyName) return res.status(400).json({ error: 'companyName is required' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid business email is required' });
  if (password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `Choose a password of at least ${MIN_PASSWORD_LEN} characters` });
  }
  if (!industryLabel) return res.status(400).json({ error: 'industryLabel is required' });
  if (!rawPages.length) return res.status(400).json({ error: 'Add at least one website page or document to train on' });
  if (await prisma.tenantUser.findUnique({ where: { email }, select: { id: true } })) {
    return res.status(409).json({ error: 'An account with this email already exists — sign in instead.' });
  }

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

  // Tenant, its first API key, documents, crawl consent and the client's
  // login are created together or not at all.
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: companyName, slug: makeSlug(companyName), industryLabel, signupEmail: email }
      });
      const { key } = await issueApiKey(tx, tenant.id, 'Website widget');
      await tx.tenantDocument.createMany({ data: pages.map((p) => ({ tenantId: tenant.id, ...p })) });
      if (consentHost) {
        await tx.tenantConsent.create({
          data: { tenantId: tenant.id, ...crawlConsentRecord({ url: String(consent.url), email, req }) }
        });
      }
      const user = await tx.tenantUser.create({
        data: { tenantId: tenant.id, email, name: contactName, passwordHash: hashPassword(password), lastLoginAt: new Date() }
      });
      return { tenant, apiKey: key, user };
    });
  } catch (e) {
    // Two signups racing on the same email: the unique index wins.
    if (e.code === 'P2002') return res.status(409).json({ error: 'An account with this email already exists — sign in instead.' });
    throw e;
  }
  // No invalidateTenantKnowledge call needed — this tenant's knowledge
  // cache has never been populated, so there's nothing stale to clear.
  // Starter questions are written in the background, usually before the
  // new client reaches the Test Bots page.
  scheduleFaqGeneration(created.tenant.id);

  res.status(201).json({
    tenantId: created.tenant.id,
    slug: created.tenant.slug,
    name: created.tenant.name,
    apiKey: created.apiKey, // shown once, on the dashboard's welcome banner
    documentsCreated: pages.length,
    // Signed straight in: the wizard lands the new client on /dashboard.
    token: signClientToken(created.user)
  });
});

module.exports = router;
