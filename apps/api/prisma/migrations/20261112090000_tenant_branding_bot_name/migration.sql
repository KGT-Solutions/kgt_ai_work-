-- Theme Studio: a custom bot display name for the widget header. Nullable;
-- null keeps the widget's default title. Additive only.

-- AlterTable
ALTER TABLE "TenantBranding" ADD COLUMN "botName" TEXT;
