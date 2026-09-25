const { rankItems } = require('../services/shared/lexicalSearch');

// Thin, domain-agnostic wrapper over the shared lexical scorer. Every domain
// profile's knowledge chunks flow through the same ranking code — nothing
// here knows about any one tenant or industry.

/**
 * @param {string} query
 * @param {import('./knowledgeLoader').KnowledgeChunk[]} chunks
 * @param {{
 *   boostTags?: Set<string>, topK?: number, minScore?: number,
 *   chunkWeight?: (chunk: import('./knowledgeLoader').KnowledgeChunk) => number,
 *   relativeMinScore?: number
 * }} [opts]
 * @returns {Array<{ chunk: import('./knowledgeLoader').KnowledgeChunk, score: number, rawScore: number }>}
 *   score is the (possibly weighted) ranking score; rawScore is the plain
 *   lexical score, which is what confidence gating must use.
 */
function retrieve(query, chunks, opts = {}) {
  const { boostTags, topK = 3, minScore = 2, chunkWeight, relativeMinScore } = opts;
  return rankItems(query, chunks, { topK, minScore, boostTags, itemWeight: chunkWeight, relativeMinScore }).map(
    ({ item, score, rawScore }) => ({ chunk: item, score, rawScore })
  );
}

module.exports = { retrieve };
