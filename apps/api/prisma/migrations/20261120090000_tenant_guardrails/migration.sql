-- Per-tenant Guardrails settings (scaffold). See schema.prisma model TenantGuardrails.
-- One row per tenant; absent = platform defaults.

CREATE TABLE "TenantGuardrails" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "maxMessages" INTEGER,
    "windowSeconds" INTEGER,
    "limitMessage" TEXT,
    "spamCheckEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockedCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "imagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantGuardrails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantGuardrails_tenantId_key" ON "TenantGuardrails"("tenantId");

ALTER TABLE "TenantGuardrails" ADD CONSTRAINT "TenantGuardrails_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
