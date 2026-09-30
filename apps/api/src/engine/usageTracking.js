const prisma = require('../lib/prisma');

// Pillar 2, tracking half only (no LiteLLM, no live Stripe calls — see the
// chat's assessment). This is the table a Stripe metered-billing sync job
// would read from later: one row per LLM call, per tenant, with real token
// counts from the provider's own response.

// Rough, approximate list prices in USD per 1K tokens — for an estimate
// visible in the dashboard, not for actual invoicing. Update as pricing
// changes; unknown models default to 0 rather than guessing.
const RATES_PER_1K = {
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

module.exports = { logUsage, logCacheHit, estimateCostUsd };
