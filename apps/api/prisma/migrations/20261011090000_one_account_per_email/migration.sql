-- One account per email address, enforced by the database as well as the API.
-- TenantUser.email is already unique; this makes the uniqueness
-- case-insensitive by requiring the stored form to be lower-cased and trimmed
-- (the API always writes it that way), and makes a self-serve company's
-- signup email unique too. Staff-created tenants have no signupEmail (NULL),
-- which a unique index allows any number of.

-- Normalise anything written before the API lower-cased emails.
UPDATE "TenantUser" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
UPDATE "Tenant" SET "signupEmail" = lower(btrim("signupEmail")) WHERE "signupEmail" <> lower(btrim("signupEmail"));

ALTER TABLE "TenantUser" ADD CONSTRAINT "TenantUser_email_normalised_check" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_signupEmail_normalised_check"
  CHECK ("signupEmail" IS NULL OR "signupEmail" = lower(btrim("signupEmail")));

CREATE UNIQUE INDEX "Tenant_signupEmail_key" ON "Tenant"("signupEmail");
