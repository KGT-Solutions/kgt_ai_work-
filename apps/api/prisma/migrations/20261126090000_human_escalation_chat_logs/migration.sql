-- Human Escalation (Feature 5) + Chat Logs (Feature 16).
--
-- Feature 5: per-tenant escalation trigger keywords + business-hours reply ETA
-- (TenantEscalationSettings), a connected Zoho Desk / Freshdesk helpdesk with
-- encrypted credentials (TenantHelpdeskIntegration) and its audit trail
-- (HelpdeskSyncLog), plus the reply-ETA + helpdesk-mirror columns on a ticket.
-- Feature 16: per-tenant chat-log retention policy (TenantRetentionSettings).
-- All additive: new tables + nullable columns, so nothing existing changes.

-- ── SupportTicket: escalation snapshot + helpdesk mirror (all nullable)
ALTER TABLE "SupportTicket" ADD COLUMN "replyEta" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "helpdeskProvider" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "helpdeskTicketId" TEXT;

-- ── TenantEscalationSettings: trigger keywords + business hours + reply ETA
CREATE TABLE "TenantEscalationSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "triggerKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywordsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "businessTimezone" TEXT,
    "businessHours" JSONB NOT NULL DEFAULT '{}',
    "replyEtaMinutes" INTEGER,
    "offHoursEtaText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantEscalationSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantEscalationSettings_tenantId_key" ON "TenantEscalationSettings"("tenantId");

ALTER TABLE "TenantEscalationSettings"
    ADD CONSTRAINT "TenantEscalationSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── TenantHelpdeskIntegration: one connected helpdesk per tenant (encrypted creds)
CREATE TABLE "TenantHelpdeskIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "freshdeskDomain" TEXT,
    "apiKey" TEXT,
    "region" TEXT,
    "orgId" TEXT,
    "departmentId" TEXT,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantHelpdeskIntegration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantHelpdeskIntegration_provider_check" CHECK ("provider" IN ('zoho_desk', 'freshdesk'))
);

CREATE UNIQUE INDEX "TenantHelpdeskIntegration_tenantId_key" ON "TenantHelpdeskIntegration"("tenantId");

ALTER TABLE "TenantHelpdeskIntegration"
    ADD CONSTRAINT "TenantHelpdeskIntegration_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── HelpdeskSyncLog: audit trail of ticket-creation attempts
CREATE TABLE "HelpdeskSyncLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT,
    "ticketId" TEXT,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL DEFAULT 'ticket.create',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalTicketId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpdeskSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelpdeskSyncLog_tenantId_createdAt_idx" ON "HelpdeskSyncLog"("tenantId", "createdAt");
CREATE INDEX "HelpdeskSyncLog_ticketId_idx" ON "HelpdeskSyncLog"("ticketId");

ALTER TABLE "HelpdeskSyncLog"
    ADD CONSTRAINT "HelpdeskSyncLog_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HelpdeskSyncLog"
    ADD CONSTRAINT "HelpdeskSyncLog_integrationId_fkey"
    FOREIGN KEY ("integrationId") REFERENCES "TenantHelpdeskIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── TenantRetentionSettings: per-tenant chat-log retention policy (Feature 16)
CREATE TABLE "TenantRetentionSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "autoPurgeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastPurgeAt" TIMESTAMP(3),
    "lastPurgedCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantRetentionSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantRetentionSettings_tenantId_key" ON "TenantRetentionSettings"("tenantId");

ALTER TABLE "TenantRetentionSettings"
    ADD CONSTRAINT "TenantRetentionSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
