const express = require('express');
const prisma = require('../lib/prisma');
const { issueApiKey } = require('../utils/tenantApiKeys');
const workspaceRoutes = require('./tenantWorkspace.routes');
const { usageBreakdowns } = require('../services/usageStats');
const { answerCache } = require('../engine/answerCache');

// KGT staff only — mounted behind requireOperator in app.js. The master
// view across every client company, plus create / inspect / activate /
// deactivate. Per-tenant work (documents, keys, chat, tickets, usage) is
// the shared workspace router, entered only after loadTenantFromParam has
// confirmed the tenant exists.
const router = express.Router();

function makeSlug(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const TENANT_FIELDS = {
  id: true, slug: true, name: true, industryLabel: true, persona: true, active: true,
  outOfScopeMessage: true, minConfidence: true, signupEmail: true, createdAt: true
};

// Per-tenant metrics for the master overview, computed in a handful of
// grouped queries rather than one query per tenant.
async function tenantMetrics(tenantIds) {
  const where = { tenantId: { in: tenantIds } };
  const [docs, keys, lastUsage, sessions, users, breakdownFor] = await Promise.all([
    prisma.tenantDocument.groupBy({ by: ['tenantId'], where, _count: { _all: true } }),
    prisma.tenantApiKey.groupBy({ by: ['tenantId'], where: { ...where, revokedAt: null }, _count: { _all: true }, _max: { lastUsedAt: true } }),
    prisma.usageLog.groupBy({ by: ['tenantId'], where, _max: { createdAt: true } }),
    prisma.chatSession.groupBy({ by: ['tenantId'], where, _count: { _all: true } }),
    prisma.tenantUser.findMany({ where, select: { tenantId: true, email: true, name: true, lastLoginAt: true }, orderBy: { createdAt: 'asc' } }),
    usageBreakdowns(tenantIds)
  ]);
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.tenantId, r]));
  const docsBy = by(docs); const keysBy = by(keys); const lastUsageBy = by(lastUsage); const sessionsBy = by(sessions);
  const usersBy = users.reduce((m, u) => ({ ...m, [u.tenantId]: [...(m[u.tenantId] || []), u] }), {});

  return (id) => {
    const { totals, ...byBot } = breakdownFor(id);
    return {
      documents: docsBy[id]?._count._all || 0,
      activeKeys: keysBy[id]?._count._all || 0,
      keyLastUsedAt: keysBy[id]?._max.lastUsedAt || null,
      llmCalls: totals.aiAnswers, // real LLM calls; cache hits are in cacheHits
      cacheHits: totals.cacheHits,
      estimatedCostUsd: totals.costUsd,
      savedCostUsd: totals.savedCostUsd,
      tokens: totals.tokens,
      tokensPerDay: totals.tokensPerDay,
      lastActivityAt: lastUsageBy[id]?._max.createdAt || null,
      conversations: sessionsBy[id]?._count._all || 0,
      questions: totals.questions,
      byBot, // { support, sales, other } — see services/usageStats.js
      accounts: (usersBy[id] || []).map(({ email, name, lastLoginAt }) => ({ email, name, lastLoginAt }))
    };
  };
}

// POST /api/v1/tenants — staff-provisioned tenant (no client login; the
// company can be given one later). Returns the API key ONCE.
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const industryLabel = String(req.body?.industryLabel || '').trim();
  if (!name || !industryLabel) return res.status(400).json({ error: 'name and industryLabel are required' });
  const slug = makeSlug(req.body?.slug || name);
  if (!slug) return res.status(400).json({ error: 'name must contain letters or digits' });

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
        },
        select: TENANT_FIELDS
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

// GET /api/v1/tenants — master overview of every client company.
router.get('/', async (req, res) => {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, select: TENANT_FIELDS });
  const metricsFor = await tenantMetrics(tenants.map((t) => t.id));
  res.json(tenants.map((t) => ({ ...t, metrics: metricsFor(t.id) })));
});

router.get('/:tenantId', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: TENANT_FIELDS });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const metricsFor = await tenantMetrics([tenant.id]);
  res.json({ ...tenant, metrics: metricsFor(tenant.id) });
});

router.patch('/:tenantId', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const data = {};
  if (req.body?.active !== undefined) data.active = !!req.body.active;
  if (req.body?.persona !== undefined) data.persona = req.body.persona || null;
  if (req.body?.minConfidence !== undefined) {
    const n = Number(req.body.minConfidence);
    if (!(n >= 0 && n <= 1)) return res.status(400).json({ error: 'minConfidence must be between 0 and 1' });
    data.minConfidence = n;
  }
  if (req.body?.outOfScopeMessage !== undefined) data.outOfScopeMessage = String(req.body.outOfScopeMessage).slice(0, 500);

  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data, select: TENANT_FIELDS });
  // persona is part of both bots' prompts: answers cached under the old one are stale.
  answerCache.invalidateTenant(tenant.id);
  res.json(updated);
});

// Staff acting inside one tenant: resolve it from the URL, then hand off to
// the shared workspace router, which reads only req.tenant.
async function loadTenantFromParam(req, res, next) {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: TENANT_FIELDS });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    req.tenant = tenant;
    req.actor = 'operator';
    next();
  } catch (err) {
    next(err);
  }
}

router.use('/:tenantId', loadTenantFromParam, workspaceRoutes);

module.exports = router;
module.exports.loadTenantFromParam = loadTenantFromParam;
