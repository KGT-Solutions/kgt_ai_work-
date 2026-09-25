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

/**
 * @param {{ profile: object, ctx: object, provider: string, model: string, usage: { promptTokens: number, completionTokens: number } }} params
 */
async function logUsage({ ctx, provider, model, usage }) {
  if (!ctx.tenantId) return null; // usage tracking requires a tenant to bill against
  try {
    return await prisma.usageLog.create({
      data: {
        tenantId: ctx.tenantId,
        provider,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        estimatedCostUsd: estimateCostUsd(model, usage)
      }
    });
  } catch (err) {
    console.error('[usageTracking] logUsage failed:', err.message);
    return null; // never let logging failure break the chat response
  }
}

module.exports = { logUsage, estimateCostUsd };
