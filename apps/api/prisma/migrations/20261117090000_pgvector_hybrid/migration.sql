-- Hybrid (lexical + semantic) retrieval. Requires a Postgres image that ships
-- pgvector (docker-compose uses pgvector/pgvector:pg16). Idempotent so it is a
-- no-op where the extension already exists (e.g. a managed Postgres where it was
-- enabled in the console).
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per "## section" chunk of a TenantDocument — the same split the
-- lexical path derives in memory — carrying its OpenAI embedding (1536-dim,
-- text-embedding-3-small). TenantDocument.content remains the source of truth;
-- these rows are rebuilt on every document write (services/shared/chunkStore.js).
-- Starts empty: existing tenants are populated by scripts/backfill-embeddings.js
-- and by the normal invalidate-on-write path, so this migration is safe on a
-- database that already has documents.
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "DocumentCategory" NOT NULL DEFAULT 'CORE_OVERVIEW',
    "scope" TEXT NOT NULL,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentChunk_tenantId_chunkKey_key" ON "DocumentChunk"("tenantId", "chunkKey");
CREATE INDEX "DocumentChunk_tenantId_idx" ON "DocumentChunk"("tenantId");
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- Approximate-nearest-neighbour index for cosine distance (the <=> operator the
-- retriever uses). HNSW handles NULL embeddings fine — un-embedded rows are
-- excluded by a `WHERE embedding IS NOT NULL` predicate in the query.
CREATE INDEX "DocumentChunk_embedding_hnsw_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TenantDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
