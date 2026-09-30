-- botType is support | sales, or NULL (platform work such as starter-FAQ
-- generation, and rows from before per-bot tracking). Enforced in the
-- database, not only by the API, so no write path can store another value.
-- Prisma can't express CHECK constraints in schema.prisma; it leaves them
-- alone when diffing, so later migrations won't drop these.

ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_botType_check"
  CHECK ("botType" IS NULL OR "botType" IN ('support', 'sales'));

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_botType_check"
  CHECK ("botType" IS NULL OR "botType" IN ('support', 'sales'));
