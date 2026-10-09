-- Sales / Support knowledge split: which bot may use each document
-- (services/shared/botScope.js). Existing documents become AUTO, so their
-- sections are classified one by one from now on.
CREATE TYPE "BotScope" AS ENUM ('AUTO', 'BOTH', 'SUPPORT', 'SALES');
ALTER TABLE "TenantDocument" ADD COLUMN "botScope" "BotScope" NOT NULL DEFAULT 'AUTO';

-- Pre-flight readiness audit (services/botAuditor.js): latest report per tenant.
ALTER TABLE "Tenant"
  ADD COLUMN "readinessScore" INTEGER,
  ADD COLUMN "readinessLevel" TEXT,
  ADD COLUMN "readinessReport" JSONB,
  ADD COLUMN "readinessContentHash" TEXT,
  ADD COLUMN "readinessAuditedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_readinessScore_check"
  CHECK ("readinessScore" IS NULL OR "readinessScore" BETWEEN 0 AND 100);
