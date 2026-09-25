-- Multi-tenant chat engine tables (resold/white-label customers).
-- FLATBRIZ's own Support/Sales bots are unaffected — this is additive.

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "industryLabel" TEXT NOT NULL,
    "persona" TEXT,
    "outOfScopeMessage" TEXT NOT NULL DEFAULT 'I don''t have this info yet. Let me connect you with support.',
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_apiKey_key" ON "Tenant"("apiKey");

CREATE TABLE "TenantDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TenantDocument_tenantId_idx" ON "TenantDocument"("tenantId");
ALTER TABLE "TenantDocument" ADD CONSTRAINT "TenantDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatSession_tenantId_idx" ON "ChatSession"("tenantId");
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "transcript" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportTicket_tenantId_status_idx" ON "SupportTicket"("tenantId", "status");
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UsageLog_tenantId_createdAt_idx" ON "UsageLog"("tenantId", "createdAt");
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
