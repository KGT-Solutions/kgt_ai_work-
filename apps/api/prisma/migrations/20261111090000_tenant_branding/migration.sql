-- Bot Branding & Theme Studio: one brand kit + its generated widget designs
-- per tenant (services/branding.js). Additive only.

-- CreateTable
CREATE TABLE "TenantBranding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "scrapedColors" JSONB NOT NULL DEFAULT '[]',
    "brandTokens" JSONB NOT NULL DEFAULT '{}',
    "generatedThemes" JSONB NOT NULL DEFAULT '[]',
    "selectedThemeId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'fallback',
    "sourceUrl" TEXT,
    "scannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantBranding_tenantId_key" ON "TenantBranding"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantBranding" ADD CONSTRAINT "TenantBranding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
