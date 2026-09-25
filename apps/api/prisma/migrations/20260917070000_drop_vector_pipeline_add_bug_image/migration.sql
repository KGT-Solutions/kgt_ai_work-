-- Drop the abandoned PDF-ingestion / pgvector RAG pipeline (BuildingDocument,
-- DocumentChunk). Superseded by a plain file-upload workflow for payment
-- proofs and bug-report screenshots instead.
DROP TABLE IF EXISTS "DocumentChunk";
DROP TABLE IF EXISTS "BuildingDocument";
DROP EXTENSION IF EXISTS vector;

-- Support & bug reporting screenshots (Requirement 3): let a resident/guard
-- attach a screenshot to a bug report, same shape as complaint/visitor photos.
ALTER TABLE "BugReport" ADD COLUMN "imageUrl" TEXT;
