-- Which bots a company deploys (signup wizard "Choose your AI workforce").
-- Existing companies keep both bots.
ALTER TABLE "Tenant" ADD COLUMN "botPreference" TEXT NOT NULL DEFAULT 'both';
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_botPreference_check"
  CHECK ("botPreference" IN ('support', 'sales', 'both'));
