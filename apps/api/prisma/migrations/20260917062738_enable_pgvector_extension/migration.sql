-- Enable pgvector before any table uses the vector(...) column type.
-- Kept in migration history (not just run by hand) so a fresh clone, CI, or
-- production deploy can `prisma migrate deploy` without a manual psql step.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "BuildingDocument" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "chunkIndex" INTEGER NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuildingDocument_buildingId_idx" ON "BuildingDocument"("buildingId");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- AddForeignKey
ALTER TABLE "BuildingDocument" ADD CONSTRAINT "BuildingDocument_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BuildingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approximate-nearest-neighbor index for cosine similarity search.
-- "lists = 100" is a reasonable default at today's scale; revisit as chunks grow.
CREATE INDEX "DocumentChunk_embedding_idx" ON "DocumentChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
