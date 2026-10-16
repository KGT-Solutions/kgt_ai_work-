-- Session-wise conversation summaries (services/chatSessions.js) and team
-- alert emails (services/teamAlerts.js).

-- Where lead and low-confidence alerts go. NULL = the signup email, then the
-- tenant's dashboard users (services/teamAlerts.js). Stored lower-cased.
ALTER TABLE "Tenant" ADD COLUMN "teamEmail" TEXT;

-- Per-conversation bookkeeping, kept up to date by services/tenantChat.js on
-- every turn, plus the AI summary of the conversation.
ALTER TABLE "ChatSession" ADD COLUMN "botType" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "lastMessageAt" TIMESTAMP(3);
ALTER TABLE "ChatSession" ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ChatSession" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER TABLE "ChatSession" ADD COLUMN "summary" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "summaryStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "ChatSession" ADD COLUMN "summarizedAt" TIMESTAMP(3);

ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_botType_check"
  CHECK ("botType" IS NULL OR "botType" IN ('support', 'sales'));
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_summaryStatus_check"
  CHECK ("summaryStatus" IN ('none', 'pending', 'ready', 'failed'));

-- Backfill from the messages already stored, so existing conversations show
-- up in the Sessions view with the right bot, size and last activity. They
-- are not summarized retroactively: the worker only looks back
-- SESSION_SUMMARY_LOOKBACK_HOURS.
UPDATE "ChatSession" s SET
  "messageCount" = m.n,
  "lastMessageAt" = m.last_at,
  "botType" = m.first_bot
FROM (
  SELECT "sessionId",
         COUNT(*)::int AS n,
         MAX("createdAt") AS last_at,
         (ARRAY_AGG("botType" ORDER BY "createdAt") FILTER (WHERE "botType" IS NOT NULL))[1] AS first_bot
  FROM "ChatMessage" GROUP BY "sessionId"
) m
WHERE m."sessionId" = s.id;

CREATE INDEX "ChatSession_tenantId_lastMessageAt_idx" ON "ChatSession"("tenantId", "lastMessageAt");
CREATE INDEX "ChatSession_lastMessageAt_idx" ON "ChatSession"("lastMessageAt");
