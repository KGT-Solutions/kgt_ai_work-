-- CreateTable
CREATE TABLE "SalesLead" (
    "id" TEXT NOT NULL,
    "clientType" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "intentScore" INTEGER NOT NULL,
    "signals" TEXT[],
    "alerted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesLead_clientType_idx" ON "SalesLead"("clientType");

-- CreateIndex
CREATE INDEX "SalesLead_intentScore_idx" ON "SalesLead"("intentScore");

-- CreateIndex
CREATE INDEX "SalesLead_createdAt_idx" ON "SalesLead"("createdAt");
