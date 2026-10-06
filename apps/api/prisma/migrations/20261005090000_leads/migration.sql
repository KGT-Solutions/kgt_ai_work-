-- Leads: a visitor who left an email in a bot conversation, with the
-- conversation's transcript and an LLM-written summary for the tenant's team
-- (services/leads.js, GET /leads on the workspace router).
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED');

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botType" TEXT NOT NULL,
    "sessionId" TEXT,
    "email" TEXT NOT NULL,
    "chatSummary" TEXT,
    "summaryStatus" TEXT NOT NULL DEFAULT 'pending',
    "fullTranscript" JSONB NOT NULL DEFAULT '[]',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "confirmationSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lead_tenantId_createdAt_idx" ON "Lead"("tenantId", "createdAt");
CREATE INDEX "Lead_tenantId_sessionId_idx" ON "Lead"("tenantId", "sessionId");
CREATE INDEX "Lead_tenantId_email_idx" ON "Lead"("tenantId", "email");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_botType_check" CHECK ("botType" IN ('support', 'sales'));
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_summaryStatus_check" CHECK ("summaryStatus" IN ('pending', 'ready', 'failed'));
