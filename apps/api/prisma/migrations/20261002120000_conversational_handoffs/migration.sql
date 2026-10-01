-- Tickets become the inbox for every handoff, not only unanswered questions:
--   kind          unanswered (below the confidence threshold) | outage (LLM down)
--                 | human_request | demo_request (asked for in the chat)
--                 | contact_request (an email left after a "can't answer that" reply)
--   contactEmail  left by the visitor in the chat, so the team can follow up
--   sessionId     the conversation, so a later email attaches to the right ticket
--   botType       which bot took it
-- confidence only means something for unanswered questions, so it may be NULL.
ALTER TABLE "SupportTicket" ALTER COLUMN "confidence" DROP NOT NULL;
ALTER TABLE "SupportTicket"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'unanswered',
  ADD COLUMN "botType" TEXT,
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_kind_check"
  CHECK ("kind" IN ('unanswered', 'outage', 'human_request', 'demo_request', 'contact_request'));
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_botType_check"
  CHECK ("botType" IS NULL OR "botType" IN ('support', 'sales'));
CREATE INDEX "SupportTicket_tenantId_sessionId_idx" ON "SupportTicket"("tenantId", "sessionId");

-- A warmer default for the below-threshold reply. Tenants still on the old
-- default get the new one; a message a tenant wrote itself is left alone.
ALTER TABLE "Tenant" ALTER COLUMN "outOfScopeMessage" SET DEFAULT
  'I''m your dedicated assistant here, and I want to make sure you get the very best care for this particular request. Would you like me to drop a quick note for our team so they can follow up with you directly?';
UPDATE "Tenant"
  SET "outOfScopeMessage" = 'I''m your dedicated assistant here, and I want to make sure you get the very best care for this particular request. Would you like me to drop a quick note for our team so they can follow up with you directly?'
  WHERE "outOfScopeMessage" = 'I don''t have this info yet. Let me connect you with support.';
