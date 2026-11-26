-- Voice Chat Polish (Feature 4): a per-message "source" tag so Chat Logs and the
-- CSV export can distinguish spoken (Speech-to-Speech) turns from typed ones, and
-- monthly voice-minute metering + caps. All additive: a new nullable column, a
-- new nullable cap column, and a new tally table.

-- How a turn was sent: 'text' (typed) or 'voice'. Existing rows default to 'text'.
ALTER TABLE "ChatMessage" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'text';

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_source_check"
  CHECK ("source" IN ('text', 'voice'));

-- Per-tenant monthly voice allowance in minutes; null = platform default, 0 = unlimited.
ALTER TABLE "TenantGuardrails" ADD COLUMN "voiceMonthlyMinutes" INTEGER;

-- Running tally of voice seconds used, one row per (tenant, UTC month).
CREATE TABLE "TenantVoiceUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "secondsUsed" INTEGER NOT NULL DEFAULT 0,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantVoiceUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantVoiceUsage_tenantId_period_key" ON "TenantVoiceUsage"("tenantId", "period");
CREATE INDEX "TenantVoiceUsage_tenantId_idx" ON "TenantVoiceUsage"("tenantId");

ALTER TABLE "TenantVoiceUsage" ADD CONSTRAINT "TenantVoiceUsage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
