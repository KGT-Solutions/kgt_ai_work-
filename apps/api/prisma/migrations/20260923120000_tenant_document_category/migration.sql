-- Universal 3-tier document categories for TenantDocument (see
-- src/services/shared/documentCategory.js). Existing rows default to
-- CORE_OVERVIEW, then a one-time backfill re-files the obvious FAQ and
-- policy/pricing documents using the same URL/title signals the crawler now
-- applies to new pages. Admins can re-categorise anything from the
-- Documents tab afterwards.
CREATE TYPE "DocumentCategory" AS ENUM ('CORE_OVERVIEW', 'FAQ', 'CUSTOM_POLICY');

ALTER TABLE "TenantDocument"
  ADD COLUMN "category" "DocumentCategory" NOT NULL DEFAULT 'CORE_OVERVIEW';

UPDATE "TenantDocument" SET "category" = 'FAQ'
WHERE COALESCE("sourceUrl", '') ~* '(faq|frequently-asked|questions|help-?cent|/support|troubleshoot)'
   OR "title" ~* '\m(faqs?|frequently asked|questions)\M';

UPDATE "TenantDocument" SET "category" = 'CUSTOM_POLICY'
WHERE "category" = 'CORE_OVERVIEW'
  AND (COALESCE("sourceUrl", '') ~* '(polic|terms|privacy|legal|pricing|prices|plans|shipping|delivery|returns|refund|warranty|cancel|manual|guide)'
       OR "title" ~* '\m(polic(y|ies)|terms|privacy|pricing|prices?|plans?|shipping|returns?|refunds?|warranty|manual|guide)\M');

CREATE INDEX "TenantDocument_tenantId_category_idx" ON "TenantDocument"("tenantId", "category");
