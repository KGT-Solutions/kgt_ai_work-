-- Email Connection (Feature 10). Per-tenant Google/Microsoft OAuth send
-- connection (Gmail API / Microsoft Graph, send-only scopes; tokens encrypted
-- at rest) plus the per-email-type toggles enforced before each category sends
-- (services/emailConnection.js). Custom SMTP (TenantSmtpConfig) is unaffected.

CREATE TABLE "TenantEmailSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT,
    "oauthEmail" TEXT,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "scope" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedBy" TEXT,
    "leadAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "attentionAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "visitorConfirmationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantEmailSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantEmailSettings_tenantId_key" ON "TenantEmailSettings"("tenantId");

ALTER TABLE "TenantEmailSettings"
    ADD CONSTRAINT "TenantEmailSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
