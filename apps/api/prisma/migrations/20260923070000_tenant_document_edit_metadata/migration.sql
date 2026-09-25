-- Adds edit/provenance metadata to TenantDocument for the Auto-Scrape + Edit
-- Documents Tab: sourceUrl marks which page a scraped doc came from (null
-- for a hand-authored one), updatedAt tracks the last edit.
ALTER TABLE "TenantDocument" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "TenantDocument" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "TenantDocument" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "TenantDocument" ALTER COLUMN "updatedAt" SET NOT NULL;
