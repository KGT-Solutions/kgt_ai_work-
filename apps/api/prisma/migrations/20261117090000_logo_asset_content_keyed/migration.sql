-- Content-keyed logo assets: one row per (tenant, image) instead of one per
-- tenant. A new logo is inserted beside the old one and the switch happens in
-- a transaction (services/branding.js), so the live key always has its row.
-- Existing rows (one per tenant) are valid rows under the new key as they are.

-- AlterTable
ALTER TABLE "TenantLogoAsset" DROP CONSTRAINT "TenantLogoAsset_pkey",
ADD CONSTRAINT "TenantLogoAsset_pkey" PRIMARY KEY ("tenantId", "key");

-- CreateIndex
CREATE INDEX "TenantLogoAsset_tenantId_reversedKey_idx" ON "TenantLogoAsset"("tenantId", "reversedKey");
