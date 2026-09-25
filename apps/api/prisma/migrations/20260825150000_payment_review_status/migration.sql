-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Payment" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "reviewedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_buildingId_status_idx" ON "Payment"("buildingId", "status");
