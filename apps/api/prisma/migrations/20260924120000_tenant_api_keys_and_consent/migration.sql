-- Moves tenant API keys out of a plaintext Tenant.apiKey column into a
-- TenantApiKey table that stores only SHA-256 hashes (and allows several keys
-- per tenant, so they can be rotated and revoked), and adds TenantConsent, the
-- audit record of the crawl authorization captured by the self-serve wizard.

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('WEBSITE_CRAWL');

-- CreateTable
CREATE TABLE "TenantApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TenantApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "domain" TEXT,
    "statement" TEXT NOT NULL,
    "statementVersion" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantApiKey_keyHash_key" ON "TenantApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "TenantApiKey_tenantId_idx" ON "TenantApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "TenantConsent_tenantId_idx" ON "TenantConsent"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantApiKey" ADD CONSTRAINT "TenantApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantConsent" ADD CONSTRAINT "TenantConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing tenant's current key becomes its first hashed key,
-- so already-deployed widgets keep working with no change on the client.
-- Must hash exactly like utils/tenantApiKeys.js hashApiKey(): sha256 of the
-- UTF-8 key, lowercase hex. keyPrefix matches KEY_PREFIX_LENGTH (9).
INSERT INTO "TenantApiKey" ("id", "tenantId", "keyHash", "keyPrefix", "label")
SELECT gen_random_uuid()::text, "id", encode(sha256(convert_to("apiKey", 'UTF8')), 'hex'), left("apiKey", 9), 'Default'
FROM "Tenant";

-- Drop the plaintext keys — after this they exist nowhere in the database.
DROP INDEX "Tenant_apiKey_key";
ALTER TABLE "Tenant" DROP COLUMN "apiKey";
