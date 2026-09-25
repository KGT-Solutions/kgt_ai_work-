-- Adds the contact email captured by the public self-serve registration
-- wizard (apps/admin-web/pages/register.js). Null for a tenant an admin
-- created directly through the internal Tenants admin page.
ALTER TABLE "Tenant" ADD COLUMN "signupEmail" TEXT;
