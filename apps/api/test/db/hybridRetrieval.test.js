const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, loadStack, createTenant, dropTenants } = require('../support/realStack');

// Hybrid retrieval against a REAL PostgreSQL with pgvector. realStack blanks
// OPENAI_API_KEY, so there is no embedding API in this layer — instead we write
// deterministic 1536-dim vectors straight into the DocumentChunk.embedding column
// and mock embeddings.embedQuery to a known query vector. That exercises exactly
// the pieces unit tests can't: the vector(1536) column, the HNSW index, the <=>
// cosine operator, and RRF fusion over real rows.
//
// This whole suite needs the `vector` extension; the db layer's migrations
// include CREATE EXTENSION, so a test DB on pgvector/pgvector:pg16 has it. On a
// Postgres without pgvector the migration step fails before these tests run.

const DIM = 1536;
// A unit vector along one axis, so cosine similarity between two axes is 0 and a
// vector with itself is 1 — fully deterministic ordering.
function axis(i) {
  const v = new Array(DIM).fill(0);
  v[i] = 1;
  return v;
}

describe('hybrid retrieval (real PostgreSQL + pgvector)', { skip: skipReason }, () => {
  let prisma, embeddings, chunkStore, hybrid, tenantProfile, acme, docIds;

  before(async () => {
    const stack = loadStack();
    prisma = stack.prisma;
    embeddings = require('../../src/services/shared/embeddings');
    chunkStore = require('../../src/services/shared/chunkStore');
    hybrid = require('../../src/engine/hybridRetriever');
    tenantProfile = require('../../src/domains/tenantProfile');

    // Fail loudly and legibly if pgvector is missing, rather than a cryptic SQL
    // error later. Cast to text — Prisma can't deserialize a raw vector-typed
    // result column (we never select the vector itself in app code either).
    await prisma.$queryRawUnsafe("SELECT '[1,0,0]'::vector::text AS v");

    acme = await createTenant(prisma, {
      name: 'Hybrid Co',
      documents: [
        { title: 'Refunds', content: '## Refund policy\n\nWe refund within 30 days of purchase.' },
        { title: 'Shipping', content: '## Delivery times\n\nStandard shipping takes three business days.' },
        { title: 'Policies', content: '## Refund policy\n\nRefund within 30 days.\n\n## Warranty\n\nOne year warranty included.' }
      ]
    });
    const docs = await prisma.tenantDocument.findMany({ where: { tenantId: acme.tenant.id } });
    docIds = Object.fromEntries(docs.map((d) => [d.title, d.id]));
  });

  after(async () => {
    mock.restoreAll();
    if (acme) await dropTenants(prisma, [acme]);
    await prisma?.$disconnect();
  });

  test('syncTenantChunks creates one row per section (null embedding without a key)', async () => {
    const r = await chunkStore.syncTenantChunks(acme.tenant.id);
    assert.equal(r.skipped, false);
    const rows = await prisma.documentChunk.findMany({ where: { tenantId: acme.tenant.id } });
    // Refunds(1) + Shipping(1) + Policies(2) = 4 sections.
    assert.equal(rows.length, 4);
    const keys = rows.map((x) => x.chunkKey).sort();
    assert.deepEqual(keys, [
      `${docIds.Policies}#0`, `${docIds.Policies}#1`, `${docIds.Refunds}#0`, `${docIds.Shipping}#0`
    ].sort());
    // No embedding provider in this layer, so embeddings are null and search
    // degrades to lexical — but the rows (the semantic index scaffold) exist.
    assert.ok(rows.every((x) => x.embedding === null || x.embedding === undefined));
    assert.ok(rows.every((x) => x.contentHash && x.contentHash.length === 64));
  });

  test('cosine <=> orders rows by similarity to a query vector', async () => {
    // Give the Refunds chunk axis(0) and the Shipping chunk axis(1).
    await prisma.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET "embedding"=$1::vector, "embeddingModel"='test' WHERE "tenantId"=$2 AND "chunkKey"=$3`,
      embeddings.toSqlVector(axis(0)), acme.tenant.id, `${docIds.Refunds}#0`
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "DocumentChunk" SET "embedding"=$1::vector, "embeddingModel"='test' WHERE "tenantId"=$2 AND "chunkKey"=$3`,
      embeddings.toSqlVector(axis(1)), acme.tenant.id, `${docIds.Shipping}#0`
    );

    // A query vector closest to axis(0) must bring the Refunds chunk back first.
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "chunkKey" FROM "DocumentChunk"
       WHERE "tenantId"=$1 AND "embedding" IS NOT NULL
       ORDER BY "embedding" <=> $2::vector ASC`,
      acme.tenant.id, embeddings.toSqlVector(axis(0))
    );
    assert.equal(rows[0].chunkKey, `${docIds.Refunds}#0`);
    assert.equal(rows[1].chunkKey, `${docIds.Shipping}#0`);
  });

  test('retrieveHybrid promotes the vector-nearest chunk through the real SQL path', async () => {
    // Query vector points at the Shipping chunk (axis 1), even though the text
    // "shipping speed" also lexically matches it — the point is the end-to-end
    // path (embedQuery -> pgvector <=> -> RRF) returns it ranked first.
    mock.method(embeddings, 'embedQuery', async () => axis(1));
    const chunks = await tenantProfile.loadTenantKnowledge(acme.tenant.id);
    const ranked = await hybrid.retrieveHybrid('shipping speed', chunks, { tenantId: acme.tenant.id, topK: 3 });
    assert.ok(ranked.length >= 1);
    assert.equal(ranked[0].chunk.chunkKey, `${docIds.Shipping}#0`);
  });

  test('re-sync removes a section that was edited away', async () => {
    // Drop the Warranty section from the Policies document.
    await prisma.tenantDocument.update({
      where: { id: docIds.Policies },
      data: { content: '## Refund policy\n\nRefund within 30 days.' }
    });
    await chunkStore.syncTenantChunks(acme.tenant.id);
    const keys = (await prisma.documentChunk.findMany({
      where: { documentId: docIds.Policies }, select: { chunkKey: true }
    })).map((x) => x.chunkKey);
    assert.deepEqual(keys, [`${docIds.Policies}#0`]); // Warranty (#1) gone
  });

  test('deleting a document cascades its chunk rows away', async () => {
    await prisma.tenantDocument.delete({ where: { id: docIds.Shipping } });
    const count = await prisma.documentChunk.count({ where: { documentId: docIds.Shipping } });
    assert.equal(count, 0);
  });
});
