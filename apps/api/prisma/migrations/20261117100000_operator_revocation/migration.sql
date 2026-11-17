-- Operator token revocation kill-switch, mirroring TenantUser.passwordChangedAt
-- and Tenant.active. A token minted at/before passwordChangedAt, or belonging to
-- a deactivated operator, is rejected on its next request (middleware/operatorAuth.js).
ALTER TABLE "Operator" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "Operator" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
