const { Prisma } = require('@prisma/client');
const { logger } = require('../lib/logger');
const prisma = require('../lib/prisma');
const { retrieve } = require('./retriever');
// Called through the module objects (not destructured) so a test's mock.method
// on them takes effect — the same convention engine/queryTranslation.js uses
// for llmClient.
const embeddings = require('../services/shared/embeddings');
const { isHybridEnabled } = require('../services/shared/chunkStore');

// Hybrid retrieval: fuses the existing lexical scorer (services/shared/lexicalSearch.js,
// via retriever.retrieve) with pgvector cosine search over DocumentChunk rows,
// using Reciprocal Rank Fusion (RRF). Purely additive and fail-safe — whenever
// the semantic side can't contribute (feature off, no tenant, embeddings
// unavailable, empty vector index, or any DB error) this returns EXACTLY what
// retrieve() returns, so the engine behaves identically to the lexical-only system.
//
// Grounding guarantee (the decision locked with the product owner): every result
// carries the chunk's LEXICAL rawScore untouched, and chatEngine's confidence
// gate reads that rawScore. RRF only decides ORDER and can pull a semantically
// strong chunk up into the top-K as extra context — but a fused set with no
// lexical evidence at all has a top rawScore of 0 and is gated to a handoff, so
// semantic matching can never push an ungrounded answer past the 30% gate.

// How many candidates each side contributes to the fusion. Larger than topK so
// a chunk ranked modestly by one side can still win on combined evidence.
function candidateCount(topK) {
  const n = Number(process.env.HYBRID_CANDIDATES);
  const base = Number.isInteger(n) && n > 0 ? n : 20;
  return Math.max(topK || 3, base);
}

// RRF constant. 60 is the canonical default from the original RRF paper; larger
// flattens the contribution of top ranks, smaller sharpens it.
function rrfK() {
  const k = Number(process.env.RRF_K);
  return Number.isFinite(k) && k > 0 ? k : 60;
}

/**
 * Cosine-nearest DocumentChunk rows for this tenant, restricted to the chunk
 * keys actually in play (the already bot-scoped, current-generation in-memory
 * chunks) so scoping and freshness exactly match the lexical side. Returns
 * chunkKeys in similarity order (closest first). Never throws.
 * @returns {Promise<string[]>}
 */
async function vectorCandidates(tenantId, queryVec, allowedKeys, limit) {
  if (!allowedKeys.length) return [];
  const sqlVec = embeddings.toSqlVector(queryVec);
  try {
    const rows = await prisma.$queryRaw`
      SELECT "chunkKey"
      FROM "DocumentChunk"
      WHERE "tenantId" = ${tenantId}
        AND "embedding" IS NOT NULL
        AND "chunkKey" IN (${Prisma.join(allowedKeys)})
      ORDER BY "embedding" <=> ${sqlVec}::vector ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => r.chunkKey);
  } catch (err) {
    // A missing extension/table, or any query error, degrades to lexical-only.
    logger.warn(`[hybridRetriever] vector search failed for tenant ${tenantId}: ${err.message}`);
    return [];
  }
}

/** rank (0-based) -> RRF contribution. */
function rrfTerm(rank, k) {
  return rank < 0 ? 0 : 1 / (k + rank + 1);
}

/**
 * Drop-in for retrieve(): same return shape `[{ chunk, score, rawScore }]`,
 * `score` now the fused RRF score (ordering), `rawScore` still the plain lexical
 * score (confidence gate). opts additionally accepts `tenantId`.
 * @param {string} query
 * @param {Array} chunks  the bot-scoped in-memory chunks (each carrying chunkKey)
 * @param {object} [opts] retrieve()'s opts plus { tenantId }
 */
async function retrieveHybrid(query, chunks, opts = {}) {
  const { tenantId, topK = 3 } = opts;
  // The canonical lexical result — what we return whenever semantic adds nothing,
  // so behavior is byte-identical to the lexical-only engine in that case.
  const lexicalFinal = retrieve(query, chunks, opts);

  if (!isHybridEnabled() || !tenantId) return lexicalFinal;

  const queryVec = await embeddings.embedQuery(query);
  if (!queryVec) return lexicalFinal; // no embeddings configured / provider down

  const chunksByKey = new Map();
  for (const c of chunks) if (c && c.chunkKey) chunksByKey.set(c.chunkKey, c);
  const allowedKeys = [...chunksByKey.keys()];

  const n = candidateCount(topK);
  const vecKeys = await vectorCandidates(tenantId, queryVec, allowedKeys, n);
  if (!vecKeys.length) return lexicalFinal; // nothing to fuse

  // Lexical candidate pool for fusion: a wider slice than the final topK, with
  // the relative-score floor lifted so more genuine matches are available to
  // RRF — but minScore (noise floor) still applies inside retrieve().
  const lexPool = retrieve(query, chunks, { ...opts, topK: n, relativeMinScore: 0 });
  const lexRank = new Map();
  const rawByKey = new Map();
  lexPool.forEach((entry, i) => {
    const key = entry.chunk.chunkKey;
    if (key == null) return;
    lexRank.set(key, i);
    rawByKey.set(key, entry.rawScore ?? entry.score ?? 0);
  });
  const vecRank = new Map();
  vecKeys.forEach((key, i) => vecRank.set(key, i));

  const k = rrfK();
  const fused = [];
  for (const key of new Set([...lexRank.keys(), ...vecRank.keys()])) {
    const chunk = chunksByKey.get(key);
    if (!chunk) continue; // only fuse chunks that are actually in scope this turn
    const score = rrfTerm(lexRank.has(key) ? lexRank.get(key) : -1, k)
      + rrfTerm(vecRank.has(key) ? vecRank.get(key) : -1, k);
    fused.push({ chunk, score, rawScore: rawByKey.get(key) ?? 0 });
  }

  // Order by fused score; break ties toward stronger lexical grounding.
  fused.sort((a, b) => b.score - a.score || b.rawScore - a.rawScore);
  const result = fused.slice(0, topK);
  // Defensive: if fusion somehow emptied the set (it shouldn't), fall back.
  return result.length ? result : lexicalFinal;
}

module.exports = { retrieveHybrid };
