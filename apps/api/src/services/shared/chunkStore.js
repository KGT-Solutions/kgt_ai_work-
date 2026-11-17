const crypto = require('crypto');
const prisma = require('../../lib/prisma');
const { embedTexts, isEmbeddingConfigured, toSqlVector, embeddingModelName } = require('./embeddings');

// Keeps the DocumentChunk table (the semantic index) in step with a tenant's
// TenantDocument rows. Normally driven from the READ path
// (domains/tenantProfile.loadTenantKnowledge), which hands us the chunks it just
// built from the SAME documentChunks() split the lexical path uses — so chunkKey
// lines up for RRF and we add no extra document read. Also called standalone by
// scripts/backfill-embeddings.js (and the db tests), where `chunks` is omitted
// and we load them ourselves.
//
// TenantDocument.content is the source of truth; these rows are a derived index.
// We embed only the chunks whose text actually changed, delete sections that
// disappeared, and never throw — a failure degrades semantic search to
// lexical-only, it does not affect a reply or a save.

// The feature switch engine/hybridRetriever.js also reads. Off => no chunk-table
// work at all, so the system behaves exactly as it did before hybrid.
function isHybridEnabled() {
  return String(process.env.HYBRID_SEARCH_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

// The text actually embedded for a chunk: its section title plus body. The title
// carries real signal ("Refund window", "SKU list") a bare body can lack.
function embedText(chunk) {
  return `${chunk.title}\n${chunk.content}`.trim();
}

function hashOf(chunk) {
  return crypto.createHash('sha256').update(embedText(chunk)).digest('hex');
}

// Serializes syncs per tenant: several can be requested close together (the
// support and sales profiles both missing the cache on one turn, or an edit
// landing just after a load kicked one off). Running them concurrently would
// race on the same rows; dropping the later one would leave the index stale.
// Chaining makes each run after the previous and see current state, so the LAST
// request always reflects the latest documents. Idempotent, so order-independent
// in outcome; the queue just removes the races.
const queues = new Map(); // tenantId -> tail of the promise chain

// Loads the tenant's chunks the same way loadTenantKnowledge does, for callers
// that don't already have them. Lazy require keeps this off the module load
// graph (tenantProfile <-> chunkStore would otherwise be a cycle).
async function loadChunks(tenantId) {
  const { documentChunks } = require('../../domains/tenantProfile');
  const documents = await prisma.tenantDocument.findMany({ where: { tenantId } });
  return documents.flatMap(documentChunks);
}

/**
 * Rebuilds (and re-embeds where needed) one tenant's DocumentChunk rows. Serialized
 * per tenant (see `queues`); the returned promise resolves when THIS request's
 * sync has run, so a caller that awaits it sees the result applied.
 * @param {string} tenantId
 * @param {Array} [chunks] the tenant's chunks (each carrying chunkKey/title/
 *   content/category/scope/documentId); loaded internally when omitted.
 * @returns {Promise<{ synced: number, embedded: number, deleted: number, skipped: boolean }>}
 */
function syncTenantChunks(tenantId, chunks) {
  const noop = { synced: 0, embedded: 0, deleted: 0, skipped: true };
  if (!tenantId || !isHybridEnabled()) return Promise.resolve(noop);
  const prev = queues.get(tenantId) || Promise.resolve();
  const run = prev.then(() => doSyncTenantChunks(tenantId, chunks), () => doSyncTenantChunks(tenantId, chunks));
  // Keep the chain alive past a rejection, and let the map entry be dropped once
  // this is the last link to settle (so an idle tenant doesn't retain a promise).
  const tail = run.catch(() => {}).finally(() => { if (queues.get(tenantId) === tail) queues.delete(tenantId); });
  queues.set(tenantId, tail);
  return run;
}

async function doSyncTenantChunks(tenantId, chunks) {
  const desired = chunks || await loadChunks(tenantId);

  const existing = await prisma.documentChunk.findMany({
    where: { tenantId },
    select: { chunkKey: true, contentHash: true, embeddingModel: true }
  });
  const existingByKey = new Map(existing.map((r) => [r.chunkKey, r]));
  const desiredKeys = new Set(desired.map((c) => c.chunkKey));
  const wantModel = isEmbeddingConfigured() ? embeddingModelName() : null;

  // A chunk is dirty if it's new, its text changed, or embeddings are now
  // available at a model it isn't yet stored under (so adding a key later
  // backfills on the next load without a content change).
  const annotated = desired.map((chunk) => {
    const hash = hashOf(chunk);
    const prev = existingByKey.get(chunk.chunkKey);
    const dirty = !prev || prev.contentHash !== hash || (wantModel != null && prev.embeddingModel !== wantModel);
    return { chunk, hash, dirty };
  });
  const dirty = annotated.filter((a) => a.dirty);
  const toDelete = existing.map((r) => r.chunkKey).filter((k) => !desiredKeys.has(k));
  if (!dirty.length && !toDelete.length) return { synced: 0, embedded: 0, deleted: 0, skipped: false };

  // Embed dirty chunks in one batched call (best-effort: nulls on failure).
  const vectors = wantModel && dirty.length ? await embedTexts(dirty.map((a) => embedText(a.chunk))) : [];

  // Apply as one transaction so the index never sits half-rebuilt for a reader.
  const ops = [];
  if (toDelete.length) {
    ops.push(prisma.documentChunk.deleteMany({ where: { tenantId, chunkKey: { in: toDelete } } }));
  }
  let embedded = 0;
  dirty.forEach((a, i) => {
    const vec = vectors[i] || null;
    if (vec) embedded += 1;
    ops.push(prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunk"
         ("id","tenantId","documentId","chunkKey","title","content","category","scope","embedding","embeddingModel","contentHash","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7::"DocumentCategory",$8,$9::vector,$10,$11,now())
       ON CONFLICT ("tenantId","chunkKey") DO UPDATE SET
         "documentId"=EXCLUDED."documentId",
         "title"=EXCLUDED."title",
         "content"=EXCLUDED."content",
         "category"=EXCLUDED."category",
         "scope"=EXCLUDED."scope",
         "embedding"=EXCLUDED."embedding",
         "embeddingModel"=EXCLUDED."embeddingModel",
         "contentHash"=EXCLUDED."contentHash",
         "updatedAt"=now()`,
      crypto.randomUUID(), tenantId, a.chunk.documentId, a.chunk.chunkKey,
      a.chunk.title, a.chunk.content, a.chunk.category, a.chunk.scope,
      vec ? toSqlVector(vec) : null, vec ? wantModel : null, a.hash
    ));
  });

  if (ops.length) await prisma.$transaction(ops);
  return { synced: dirty.length, embedded, deleted: toDelete.length, skipped: false };
}

module.exports = { syncTenantChunks, isHybridEnabled, embedText };
