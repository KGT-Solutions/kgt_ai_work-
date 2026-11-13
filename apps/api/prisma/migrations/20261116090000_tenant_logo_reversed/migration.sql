-- The reversed variant of a hosted logo, shown on headers the original
-- doesn't contrast with (dark lettering on a dark header) instead of boxing
-- it on a plate. Nullable: existing logos simply have none until re-saved.

-- AlterTable
ALTER TABLE "TenantLogoAsset" ADD COLUMN "reversedData" BYTEA,
ADD COLUMN "reversedKey" TEXT;
