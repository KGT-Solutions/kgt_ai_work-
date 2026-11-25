-- Client-facing Instructions Editor (Feature 11). Per-assistant tone/style/
-- length preferences + free-text guidance, layered onto the system prompt
-- subordinate to the locked grounding/safety rules (services/tenantInstructions.js).
-- Append-only version history for view/restore.

CREATE TABLE "TenantInstruction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botType" TEXT NOT NULL,
    "tone" TEXT,
    "style" TEXT,
    "length" TEXT,
    "guidance" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantInstruction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenantInstruction_tenantId_botType_key" ON "TenantInstruction"("tenantId", "botType");
CREATE INDEX "TenantInstruction_tenantId_idx" ON "TenantInstruction"("tenantId");

ALTER TABLE "TenantInstruction"
    ADD CONSTRAINT "TenantInstruction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenantInstructionVersion" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "botType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "tone" TEXT,
    "style" TEXT,
    "length" TEXT,
    "guidance" TEXT,
    "summary" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantInstructionVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantInstructionVersion_instructionId_version_idx" ON "TenantInstructionVersion"("instructionId", "version");
CREATE INDEX "TenantInstructionVersion_tenantId_botType_version_idx" ON "TenantInstructionVersion"("tenantId", "botType", "version");

ALTER TABLE "TenantInstructionVersion"
    ADD CONSTRAINT "TenantInstructionVersion_instructionId_fkey"
    FOREIGN KEY ("instructionId") REFERENCES "TenantInstruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
