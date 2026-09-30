-- Per-bot usage tracking and answer-cache accounting.
-- Existing rows keep botType NULL (recorded before per-bot tracking) and cacheHit false.

-- AlterTable
ALTER TABLE "UsageLog" ADD COLUMN     "botType" TEXT,
ADD COLUMN     "cacheHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "savedTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "savedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "botType" TEXT;

-- CreateIndex
CREATE INDEX "UsageLog_tenantId_botType_createdAt_idx" ON "UsageLog"("tenantId", "botType", "createdAt");
