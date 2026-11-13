-- Client-uploaded logos: the re-encoded image in its own table (so the bytes
-- are never read with every TenantBranding row), and the content key on the
-- branding row that marks it as the logo in use.

-- AlterTable
ALTER TABLE "TenantBranding" ADD COLUMN "customLogoKey" TEXT;

-- CreateTable
CREATE TABLE "TenantLogoAsset" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantLogoAsset_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "TenantLogoAsset" ADD CONSTRAINT "TenantLogoAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
