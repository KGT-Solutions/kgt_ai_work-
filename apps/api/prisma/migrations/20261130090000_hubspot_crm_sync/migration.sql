-- HubSpot CRM Sync (Feature 9). Additive only: HubSpot reuses the existing
-- TenantCRMIntegration + CRMSyncLog tables (provider already supports HUBSPOT).
-- The one new field is the HubSpot account (hub/portal) id, so an inbound
-- HubSpot webhook — which carries only portalId + object id — can be routed to
-- the right tenant and a per-portal contact id can't collide across tenants.

ALTER TABLE "TenantCRMIntegration" ADD COLUMN "portalId" TEXT;

CREATE INDEX "TenantCRMIntegration_provider_portalId_idx"
  ON "TenantCRMIntegration" ("provider", "portalId");
