-- Per-tenant monthly AI spend cap (tokens). Null => use DEFAULT_MONTHLY_TOKEN_BUDGET;
-- <= 0 or unset default => no cap. Enforced in engine/usageTracking.isTenantOverBudget.
ALTER TABLE "Tenant" ADD COLUMN "monthlyTokenBudget" INTEGER;
