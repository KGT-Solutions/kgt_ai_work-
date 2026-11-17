const prisma = require('../lib/prisma');
const { store } = require('../lib/sharedStore');

// Pillar 2, tracking half only (no LiteLLM, no live Stripe calls — see the
// chat's assessment). This is the table a Stripe metered-billing sync job
// would read from later: one row per LLM call, per tenant, with real token
// counts from the provider's own response.
//
// It also backs a lightweight SPEND GUARDRAIL: isTenantOverBudget() compares a
// tenant's month-to-date token usage against its cap, so chatEngine can refuse to
// call the model for a tenant that has blown its budget (preventing runaway LLM
// bills from a misconfigured embed or an abusive loop).

// Rough, approximate list prices in USD per 1K tokens — for an estimate
// visible in the dashboard, not for actual invoicing. Update as pricing
// changes; unknown models default to 0 rather than guessing.
const RATES_PER_1K = {
  // DEFAULT_MODELS.groq in engine/llmClient.js. Without this row every Groq
  // answer logged $0.00 and the dashboard's whole cost column read zero for
  // any deployment running Groq as its primary provider.
  'openai/gpt-oss-120b': { prompt: 0.00015, completion: 0.0006 },
  'llama-3.3-70b-versatile': { prompt: 0.00059, completion: 0.00079 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'claude-haiku-4-5-20251001': { prompt: 0.001, completion: 0.005 }
};

function estimateCostUsd(model, usage) {
  const rate = RATES_PER_1K[model];
  if (!rate) return 0;
  return (usage.promptTokens / 1000) * rate.prompt + (usage.completionTokens / 1000) * rate.completion;
}

const BOT_TYPES = ['support', 'sales'];
const botTypeOrNull = (botType) => (BOT_TYPES.includes(botType) ? botType : null);

async function writeUsage(data) {
  try {
    return await prisma.usageLog.create({ data });
  } catch (err) {
    console.error('[usageTracking] logUsage failed:', err.message);
    return null; // never let logging failure break the chat response
  }
}

/**
 * One real LLM call.
 * @param {{ ctx: object, provider: string, model: string, usage: { promptTokens: number, completionTokens: number }, botType?: string }} params
 *   botType: 'support' | 'sales' for a chat answer; omitted for platform work (e.g. starter FAQs).
 */
async function logUsage({ ctx, provider, model, usage, botType }) {
  if (!ctx.tenantId) return null; // usage tracking requires a tenant to bill against
  return writeUsage({
    tenantId: ctx.tenantId,
    botType: botTypeOrNull(botType),
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    estimatedCostUsd: estimateCostUsd(model, usage)
  });
}

/**
 * An answer served from the answer cache: 0 tokens and $0 spent, with the
 * original call's tokens and cost recorded as saved.
 * @param {{ ctx: object, botType: string, model: string, usage: { promptTokens: number, completionTokens: number } }} params
 *   model/usage: those of the call that produced the cached answer.
 */
async function logCacheHit({ ctx, botType, model, usage }) {
  if (!ctx.tenantId) return null;
  return writeUsage({
    tenantId: ctx.tenantId,
    botType: botTypeOrNull(botType),
    provider: 'cache',
    model,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    cacheHit: true,
    savedTokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
    savedCostUsd: estimateCostUsd(model, usage)
  });
}

// ---------------------------------------------------------------------
// Per-tenant monthly spend guardrail.
// ---------------------------------------------------------------------

// How long the over/under decision is cached in the shared store. Short, so the
// cap re-checks regularly; a tenant can overshoot by at most one window's worth of
// traffic, which is an acceptable trade for not aggregating UsageLog every turn.
const BUDGET_CACHE_TTL_MS = 5 * 60 * 1000;

// Platform-wide default cap applied when a tenant has no monthlyTokenBudget of its
// own. 0 / unset means "no default cap" (guardrail off unless a tenant opts in).
function defaultMonthlyTokenBudget() {
  const n = Number(process.env.DEFAULT_MONTHLY_TOKEN_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// First instant of the current calendar month, UTC — the window spend is summed over.
function monthStartUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Whether this tenant has reached its monthly token cap. Cached in the shared
 * store (so every replica agrees and it costs one DB aggregate per window). Fails
 * OPEN — any error returns false, because a guardrail hiccup must never take a
 * tenant's bots offline; the provider's own spend limits remain the backstop.
 * @param {string} tenantId
 * @returns {Promise<boolean>}
 */
async function isTenantOverBudget(tenantId) {
  if (!tenantId) return false;
  const monthKey = monthStartUtc().toISOString().slice(0, 7); // YYYY-MM
  const cacheKey = `budget:over:${tenantId}:${monthKey}`;
  try {
    const cached = await store().get(cacheKey);
    if (cached === true || cached === false) return cached;
  } catch { /* cache unavailable: compute fresh */ }

  let over = false;
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { monthlyTokenBudget: true } });
    const budget = (tenant?.monthlyTokenBudget ?? 0) > 0 ? tenant.monthlyTokenBudget : defaultMonthlyTokenBudget();
    if (budget > 0) {
      const agg = await prisma.usageLog.aggregate({
        where: { tenantId, createdAt: { gte: monthStartUtc() } },
        _sum: { promptTokens: true, completionTokens: true }
      });
      const used = (agg._sum.promptTokens || 0) + (agg._sum.completionTokens || 0);
      over = used >= budget;
    }
  } catch (err) {
    console.error('[usageTracking] budget check failed (failing open):', err.message);
    return false;
  }
  store().set(cacheKey, over, BUDGET_CACHE_TTL_MS).catch(() => {}); // best-effort
  return over;
}

module.exports = { logUsage, logCacheHit, estimateCostUsd, isTenantOverBudget };
