-- Full-Site Sitemap Sync, Weekly Auto-Refresh & Change Reports (Feature 2).
-- Additive: two new tables, no change to any existing table. Both are strictly
-- tenant-scoped and cascade with the owning Tenant.

-- Per-tenant crawl source + weekly schedule (one row per tenant).
CREATE TABLE "TenantCrawlSource" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "url"           TEXT,
  "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastRunAt"     TIMESTAMP(3),
  "lastRunId"     TEXT,
  "lastStatus"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantCrawlSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantCrawlSource_tenantId_key" ON "TenantCrawlSource"("tenantId");

ALTER TABLE "TenantCrawlSource"
  ADD CONSTRAINT "TenantCrawlSource_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One sitemap-sync run and its change report.
CREATE TABLE "TenantCrawlRun" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "sourceUrl"       TEXT NOT NULL,
  "trigger"         TEXT NOT NULL DEFAULT 'manual',
  "status"          TEXT NOT NULL DEFAULT 'running',
  "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
  "pagesAdded"      INTEGER NOT NULL DEFAULT 0,
  "pagesUpdated"    INTEGER NOT NULL DEFAULT 0,
  "pagesRemoved"    INTEGER NOT NULL DEFAULT 0,
  "pagesUnchanged"  INTEGER NOT NULL DEFAULT 0,
  "errorsCount"     INTEGER NOT NULL DEFAULT 0,
  "report"          JSONB,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"      TIMESTAMP(3),
  CONSTRAINT "TenantCrawlRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantCrawlRun_trigger_check" CHECK ("trigger" IN ('manual', 'scheduled')),
  CONSTRAINT "TenantCrawlRun_status_check" CHECK ("status" IN ('running', 'completed', 'failed'))
);

CREATE INDEX "TenantCrawlRun_tenantId_idx" ON "TenantCrawlRun"("tenantId");
CREATE INDEX "TenantCrawlRun_tenantId_startedAt_idx" ON "TenantCrawlRun"("tenantId", "startedAt");

ALTER TABLE "TenantCrawlRun"
  ADD CONSTRAINT "TenantCrawlRun_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
