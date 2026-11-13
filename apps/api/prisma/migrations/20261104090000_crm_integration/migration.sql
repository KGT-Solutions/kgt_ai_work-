-- Bi-directional CRM integration (services/crm/*). One connection per tenant;
-- OAuth tokens are stored as AES-256-GCM ciphertext only (utils/encryption.js),
-- like SMTP passwords. CRMSyncLog is the audit trail of every sync attempt.

CREATE TYPE "CRMProvider" AS ENUM ('ZOHO', 'HUBSPOT');
CREATE TYPE "CRMSyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING');

CREATE TABLE "TenantCRMIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "CRMProvider" NOT NULL DEFAULT 'ZOHO',
    "region" TEXT NOT NULL DEFAULT 'com',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "fieldMapping" JSONB NOT NULL DEFAULT '{}',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCRMIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantCRMIntegration_tenantId_key" ON "TenantCRMIntegration"("tenantId");
CREATE INDEX "TenantCRMIntegration_tenantId_idx" ON "TenantCRMIntegration"("tenantId");

ALTER TABLE "TenantCRMIntegration" ADD CONSTRAINT "TenantCRMIntegration_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CRMSyncLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationId" TEXT,
    "leadId" TEXT,
    "provider" "CRMProvider" NOT NULL DEFAULT 'ZOHO',
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "operation" TEXT NOT NULL,
    "status" "CRMSyncStatus" NOT NULL DEFAULT 'PENDING',
    "crmRecordId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CRMSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CRMSyncLog_tenantId_createdAt_idx" ON "CRMSyncLog"("tenantId", "createdAt");
CREATE INDEX "CRMSyncLog_leadId_idx" ON "CRMSyncLog"("leadId");

ALTER TABLE "CRMSyncLog" ADD CONSTRAINT "CRMSyncLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CRMSyncLog" ADD CONSTRAINT "CRMSyncLog_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "TenantCRMIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The CRM mirror of each lead, so an inbound status webhook can map a CRM
-- record back to its KGT Lead row.
ALTER TABLE "Lead" ADD COLUMN "crmProvider" "CRMProvider";
ALTER TABLE "Lead" ADD COLUMN "crmRecordId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "crmSyncedAt" TIMESTAMP(3);

CREATE INDEX "Lead_tenantId_crmRecordId_idx" ON "Lead"("tenantId", "crmRecordId");
