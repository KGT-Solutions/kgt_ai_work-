-- One lead per (tenant, bot, conversation, email). Two simultaneous captures
-- used to both pass a find-then-create and insert twice, so a database that
-- has seen that race holds duplicates — merged here first, or the unique
-- index below could not be created.
--
-- Of each duplicate group the lead with the most progress is kept: one
-- already synced to the CRM, then one a rep already contacted, then the
-- oldest. CRMSyncLog rows (leadId has no foreign key) are repointed to it so
-- the audit trail stays attached. Rows with a NULL sessionId never collide
-- under the index and are left alone.

CREATE TEMP TABLE "_lead_duplicates" AS
SELECT
  "id",
  FIRST_VALUE("id") OVER w AS "keeperId",
  ROW_NUMBER() OVER w AS "rank"
FROM "Lead"
WHERE "sessionId" IS NOT NULL
WINDOW w AS (
  PARTITION BY "tenantId", "botType", "sessionId", "email"
  ORDER BY ("crmRecordId" IS NULL), ("status" = 'NEW'), "createdAt", "id"
);

UPDATE "CRMSyncLog" AS log
SET "leadId" = dup."keeperId"
FROM "_lead_duplicates" AS dup
WHERE log."leadId" = dup."id" AND dup."rank" > 1;

DELETE FROM "Lead"
WHERE "id" IN (SELECT "id" FROM "_lead_duplicates" WHERE "rank" > 1);

DROP TABLE "_lead_duplicates";

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_botType_sessionId_email_key" ON "Lead"("tenantId", "botType", "sessionId", "email");
