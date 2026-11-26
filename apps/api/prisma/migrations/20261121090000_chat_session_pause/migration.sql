-- A conversation can be paused (no bot replies) by spam auto-detection or by a
-- human from Chat Logs. pauseReason is constrained to the two known reasons.
ALTER TABLE "ChatSession" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "ChatSession" ADD COLUMN "pauseReason" TEXT;

ALTER TABLE "ChatSession"
  ADD CONSTRAINT "ChatSession_pauseReason_check"
  CHECK ("pauseReason" IS NULL OR "pauseReason" IN ('spam', 'manual'));
