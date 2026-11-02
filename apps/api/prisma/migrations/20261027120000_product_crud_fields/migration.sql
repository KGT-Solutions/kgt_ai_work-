-- Per-item category, image, and an updatedAt for in-dashboard CRUD editing.
ALTER TABLE "ProductCatalog" ADD COLUMN "category" TEXT;
ALTER TABLE "ProductCatalog" ADD COLUMN "imageUrl" TEXT;
-- NOT NULL with a default so any existing rows backfill cleanly; the app
-- (Prisma @updatedAt) maintains it from here.
ALTER TABLE "ProductCatalog" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- ...then drop the default, because schema.prisma declares this column as
-- @updatedAt with no @default, and every other @updatedAt column in the schema
-- is plain "TIMESTAMP(3) NOT NULL" (see 20260925000000_init). Leaving the
-- default in place makes the migrated database disagree with schema.prisma,
-- which test/system/migrations.test.js fails on as drift — the backfill is the
-- only thing the default was needed for.
ALTER TABLE "ProductCatalog" ALTER COLUMN "updatedAt" DROP DEFAULT;
