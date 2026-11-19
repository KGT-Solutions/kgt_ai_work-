-- Websites allowed to use a widget key from a browser. Empty (the default)
-- means any origin, so every existing key keeps working unchanged.

-- AlterTable
ALTER TABLE "TenantApiKey" ADD COLUMN "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[];
