-- Visitor chat image uploads: content-hashed per tenant, EXIF stripped at
-- ingest (services/shared/chatImage.js), referenced from ChatMessage.imageKeys.

ALTER TABLE "ChatMessage" ADD COLUMN "imageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "ChatImageAsset" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatImageAsset_pkey" PRIMARY KEY ("tenantId", "key")
);

CREATE INDEX "ChatImageAsset_tenantId_idx" ON "ChatImageAsset"("tenantId");

ALTER TABLE "ChatImageAsset"
    ADD CONSTRAINT "ChatImageAsset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
