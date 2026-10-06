-- Marks the assistant replies that actually answered from the knowledge base,
-- so the visitor's lead confirmation email can recap them (services/leads.js).
-- Existing rows are false: their emails simply carry no recap.
ALTER TABLE "ChatMessage" ADD COLUMN "answered" BOOLEAN NOT NULL DEFAULT false;
