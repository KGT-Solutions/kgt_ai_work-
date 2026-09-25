-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "receiptUrl" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceConfig" ADD COLUMN "qrImageUrl" TEXT;

-- AlterTable
ALTER TABLE "SocietyExpense" ADD COLUMN "imageUrl" TEXT;
