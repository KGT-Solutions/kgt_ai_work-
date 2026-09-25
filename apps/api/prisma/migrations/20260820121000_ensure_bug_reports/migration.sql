-- Additive: safe on existing Postgres volumes that already have the rest of the schema.
CREATE TABLE IF NOT EXISTS "BugReport" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reference" TEXT NOT NULL,
    "flatNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BugReport_buildingId_idx" ON "BugReport"("buildingId");
CREATE INDEX IF NOT EXISTS "BugReport_userId_idx" ON "BugReport"("userId");
CREATE INDEX IF NOT EXISTS "BugReport_status_idx" ON "BugReport"("status");
CREATE INDEX IF NOT EXISTS "BugReport_createdAt_idx" ON "BugReport"("createdAt");

DO $$ BEGIN
  ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_buildingId_fkey"
    FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
