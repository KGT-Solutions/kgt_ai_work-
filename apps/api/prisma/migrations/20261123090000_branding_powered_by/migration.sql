-- Free, owner-toggleable "Powered by KGT Orb" footer strip in the chat widget
-- (services/branding.js). true = shown; the permanent "You are chatting with an
-- AI assistant" notice is separate and can never be hidden. Defaults to shown,
-- so existing tenants keep the strip until they turn it off.

ALTER TABLE "TenantBranding" ADD COLUMN "showBranding" BOOLEAN NOT NULL DEFAULT true;
