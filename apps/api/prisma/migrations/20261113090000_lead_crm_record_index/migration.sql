-- The inbound Zoho status webhook looks a lead up by (crmProvider,
-- crmRecordId), usually without a tenant hint. The existing
-- (tenantId, crmRecordId) index can't serve that, so it scanned Lead.

-- CreateIndex
CREATE INDEX "Lead_crmProvider_crmRecordId_idx" ON "Lead"("crmProvider", "crmRecordId");
