-- LLM-generated starter questions per tenant, shown as chips in the Test Bots sandbox.

-- CreateTable
CREATE TABLE "TenantFaq" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supportFaqs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salesFaqs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFaq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantFaq_tenantId_key" ON "TenantFaq"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantFaq" ADD CONSTRAINT "TenantFaq_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
