-- Webhooks & Google Sheets sync (Feature 8). Additive: three new tables, no
-- change to any existing table. All strictly tenant-scoped and cascade with the
-- owning Tenant (and a delivery cascades with its webhook).

-- Per-tenant outbound webhook endpoints.
CREATE TABLE "TenantWebhook" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "url"            TEXT NOT NULL,
  "secret"         TEXT NOT NULL,
  "events"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "description"    TEXT,
  "lastStatus"     TEXT,
  "lastDeliveryAt" TIMESTAMP(3),
  "failureCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantWebhook_tenantId_idx" ON "TenantWebhook"("tenantId");

ALTER TABLE "TenantWebhook"
  ADD CONSTRAINT "TenantWebhook_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One webhook delivery outcome (status + short error only; never bodies/secrets).
CREATE TABLE "WebhookDelivery" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "webhookId"  TEXT NOT NULL,
  "event"      TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "statusCode" INTEGER,
  "attempts"   INTEGER NOT NULL DEFAULT 1,
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookDelivery_status_check" CHECK ("status" IN ('success', 'failed'))
);

CREATE INDEX "WebhookDelivery_tenantId_createdAt_idx" ON "WebhookDelivery"("tenantId", "createdAt");
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "TenantWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-tenant Google Sheets sync connection + config (one row per tenant).
CREATE TABLE "TenantSheetSync" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "refreshToken"    TEXT,
  "accessToken"     TEXT,
  "tokenExpiry"     TIMESTAMP(3),
  "scope"           TEXT,
  "connectedEmail"  TEXT,
  "connectedAt"     TIMESTAMP(3),
  "connectedBy"     TEXT,
  "spreadsheetId"   TEXT,
  "spreadsheetName" TEXT,
  "events"          TEXT[] NOT NULL DEFAULT ARRAY['lead.created']::TEXT[],
  "enabled"         BOOLEAN NOT NULL DEFAULT false,
  "lastStatus"      TEXT,
  "lastSyncAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantSheetSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantSheetSync_tenantId_key" ON "TenantSheetSync"("tenantId");

ALTER TABLE "TenantSheetSync"
  ADD CONSTRAINT "TenantSheetSync_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
