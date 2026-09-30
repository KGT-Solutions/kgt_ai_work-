const prisma = require('../lib/prisma');

// Per-bot usage and cost, for one tenant (client dashboard) or many (staff
// overview) — the same queries and the same shape, so the two views can't
// disagree. Every query is filtered by the tenant ids passed in.
//
// Buckets:
//   support, sales  chat answers, from UsageLog.botType / ChatMessage.botType
//   other           LLM work not tied to a bot (starter-FAQ generation) and
//                   rows recorded before per-bot tracking existed
//
// Per bucket: questions asked, AI answers (real LLM calls), cache hits,
// tokens, cost, and what the cache saved. cacheHitRate is the share of
// answers that needed a model and were served from cache instead.

const BUCKETS = ['support', 'sales', 'other'];
const BURN_WINDOW_DAYS = 7;
const bucketOf = (botType) => (botType === 'support' || botType === 'sales' ? botType : 'other');

function emptyBucket() {
  return {
    questions: 0, aiAnswers: 0, cacheHits: 0,
    promptTokens: 0, completionTokens: 0, tokens: 0, costUsd: 0,
    savedTokens: 0, savedCostUsd: 0, cacheHitRate: 0,
    tokens7d: 0, costUsd7d: 0, tokensPerDay: 0
  };
}

function emptyBreakdown() {
  return { ...Object.fromEntries(BUCKETS.map((b) => [b, emptyBucket()])), totals: emptyBucket() };
}

/**
 * Folds grouped rows into { support, sales, other, totals } per tenant.
 * Pure (no DB), so it's unit-tested directly.
 * @param {{ usage: array, recent: array, questions: array }} rows
 *   usage:     groupBy [tenantId, botType, cacheHit] with _count._all and _sum
 *   recent:    groupBy [tenantId, botType] over the burn window (real calls only)
 *   questions: [{ tenantId, botType, n }] user messages
 * @returns {Map<string, object>} tenantId -> breakdown
 */
function foldBreakdowns({ usage = [], recent = [], questions = [] }) {
  const out = new Map();
  const get = (tenantId) => {
    if (!out.has(tenantId)) out.set(tenantId, emptyBreakdown());
    return out.get(tenantId);
  };

  for (const r of usage) {
    const b = get(r.tenantId)[bucketOf(r.botType)];
    const s = r._sum || {};
    if (r.cacheHit) {
      b.cacheHits += r._count._all;
      b.savedTokens += s.savedTokens || 0;
      b.savedCostUsd += s.savedCostUsd || 0;
    } else {
      b.aiAnswers += r._count._all;
      b.promptTokens += s.promptTokens || 0;
      b.completionTokens += s.completionTokens || 0;
      b.costUsd += s.estimatedCostUsd || 0;
    }
  }
  for (const r of recent) {
    const b = get(r.tenantId)[bucketOf(r.botType)];
    b.tokens7d += (r._sum?.promptTokens || 0) + (r._sum?.completionTokens || 0);
    b.costUsd7d += r._sum?.estimatedCostUsd || 0;
  }
  for (const r of questions) get(r.tenantId)[bucketOf(r.botType)].questions += r.n;

  for (const breakdown of out.values()) {
    const t = breakdown.totals;
    for (const name of BUCKETS) {
      const b = breakdown[name];
      b.tokens = b.promptTokens + b.completionTokens;
      b.tokensPerDay = Math.round(b.tokens7d / BURN_WINDOW_DAYS);
      b.cacheHitRate = b.aiAnswers + b.cacheHits ? b.cacheHits / (b.aiAnswers + b.cacheHits) : 0;
      for (const k of Object.keys(t)) if (k !== 'cacheHitRate') t[k] += b[k];
    }
    t.cacheHitRate = t.aiAnswers + t.cacheHits ? t.cacheHits / (t.aiAnswers + t.cacheHits) : 0;
  }
  return out;
}

/**
 * @param {string[]} tenantIds
 * @returns {Promise<(tenantId: string) => object>} lookup; an unknown id gets all zeros
 */
async function usageBreakdowns(tenantIds) {
  if (!tenantIds.length) return () => emptyBreakdown();
  const where = { tenantId: { in: tenantIds } };
  const since = new Date(Date.now() - BURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [usage, recent, questions] = await Promise.all([
    prisma.usageLog.groupBy({
      by: ['tenantId', 'botType', 'cacheHit'],
      where,
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, estimatedCostUsd: true, savedTokens: true, savedCostUsd: true }
    }),
    prisma.usageLog.groupBy({
      by: ['tenantId', 'botType'],
      where: { ...where, cacheHit: false, createdAt: { gte: since } },
      _sum: { promptTokens: true, completionTokens: true, estimatedCostUsd: true }
    }),
    prisma.$queryRaw`SELECT s."tenantId" AS "tenantId", m."botType" AS "botType", COUNT(*)::int AS n
      FROM "ChatMessage" m JOIN "ChatSession" s ON s.id = m."sessionId"
      WHERE m.role = 'user' AND s."tenantId" = ANY(${tenantIds}) GROUP BY 1, 2`
  ]);
  const byTenant = foldBreakdowns({ usage, recent, questions });
  return (tenantId) => byTenant.get(tenantId) || emptyBreakdown();
}

module.exports = { usageBreakdowns, foldBreakdowns, emptyBreakdown, BURN_WINDOW_DAYS };
