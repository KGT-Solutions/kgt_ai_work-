const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// hybridRetriever -> lib/prisma constructs a PrismaClient at load. We never run a
// real query here (prisma.$queryRaw is mocked), but the client needs a
// syntactically valid URL to construct. Set a dummy one if the unit env has none.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/db?schema=public';

const { retrieveHybrid } = require('../../src/engine/hybridRetriever');
const { retrieve } = require('../../src/engine/retriever');
const embeddings = require('../../src/services/shared/embeddings');
const prisma = require('../../src/lib/prisma');

const DIM = embeddings.EMBEDDING_DIM;
const qvec = Array.from({ length: DIM }, () => 0.1);

// Shaped like domains/tenantProfile.documentChunks() output.
const CHUNKS = [
  { chunkKey: 'doc1#0', documentId: 'doc1', title: 'Refund policy', tags: [], category: 'CUSTOM_POLICY', scope: 'both',
    content: 'Our refund window is 30 days. Return any item for a full refund.' },
  { chunkKey: 'doc1#1', documentId: 'doc1', title: 'Shipping and delivery', tags: [], category: 'CUSTOM_POLICY', scope: 'both',
    content: 'Standard shipping takes three business days.' },
  { chunkKey: 'doc2#0', documentId: 'doc2', title: 'Membership perks', tags: [], category: 'CORE_OVERVIEW', scope: 'both',
    content: 'Members earn points and unlock exclusive discounts over time.' }
];

// Makes prisma.$queryRaw return the given chunkKeys in order (the vector side).
function stubVector(chunkKeys) {
  mock.method(prisma, '$queryRaw', async () => chunkKeys.map((chunkKey) => ({ chunkKey })));
}
function stubQueryVec(vec = qvec) {
  mock.method(embeddings, 'embedQuery', async () => vec);
}

describe('hybridRetriever: retrieveHybrid', () => {
  let savedFlag;
  beforeEach(() => { savedFlag = process.env.HYBRID_SEARCH_ENABLED; process.env.HYBRID_SEARCH_ENABLED = 'true'; });
  afterEach(() => {
    mock.restoreAll();
    if (savedFlag === undefined) delete process.env.HYBRID_SEARCH_ENABLED; else process.env.HYBRID_SEARCH_ENABLED = savedFlag;
  });

  test('an exact keyword query keeps the exact chunk ranked first', async () => {
    stubQueryVec();
    stubVector(['doc1#0', 'doc2#0']);
    const ranked = await retrieveHybrid('refund window', CHUNKS, { tenantId: 't1' });
    assert.equal(ranked[0].chunk.chunkKey, 'doc1#0');
  });

  test('semantic recall: surfaces a conceptually-relevant chunk lexical search misses', async () => {
    // "loyalty program" shares no words/stems with any chunk, so pure lexical
    // finds nothing...
    assert.equal(retrieve('loyalty program', CHUNKS).length, 0);
    // ...but the vector side ranks the membership chunk, and hybrid returns it.
    stubQueryVec();
    stubVector(['doc2#0']);
    const ranked = await retrieveHybrid('loyalty program', CHUNKS, { tenantId: 't1' });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].chunk.chunkKey, 'doc2#0');
    // A vector-only match carries no lexical grounding, so its rawScore is 0 —
    // which is exactly what makes chatEngine's gate treat it as ungrounded.
    assert.equal(ranked[0].rawScore, 0);
  });

  test('RRF reorders: a strong vector match outranks the top lexical match', async () => {
    // Lexical ranks the refund chunk above the shipping chunk for this query.
    const lexical = retrieve('return item delivery', CHUNKS);
    assert.equal(lexical[0].chunk.chunkKey, 'doc1#0');
    // The vector side prefers the shipping chunk; fusion promotes it to #1.
    stubQueryVec();
    stubVector(['doc1#1']);
    const ranked = await retrieveHybrid('return item delivery', CHUNKS, { tenantId: 't1' });
    assert.equal(ranked[0].chunk.chunkKey, 'doc1#1');
  });

  test('rawScore passthrough: lexical scores reach the result unchanged (gate unaffected)', async () => {
    stubQueryVec();
    stubVector(['doc1#1']);
    const lexical = retrieve('return item delivery', CHUNKS);
    const lexByKey = new Map(lexical.map((e) => [e.chunk.chunkKey, e.rawScore]));
    const ranked = await retrieveHybrid('return item delivery', CHUNKS, { tenantId: 't1' });
    for (const entry of ranked) {
      if (lexByKey.has(entry.chunk.chunkKey)) {
        assert.equal(entry.rawScore, lexByKey.get(entry.chunk.chunkKey));
      }
    }
  });

  test('embeddings unavailable ⇒ identical to retrieve()', async () => {
    mock.method(embeddings, 'embedQuery', async () => null);
    const hybrid = await retrieveHybrid('refund window', CHUNKS, { tenantId: 't1' });
    assert.deepEqual(hybrid, retrieve('refund window', CHUNKS, { tenantId: 't1' }));
  });

  test('feature flag off ⇒ identical to retrieve() and no embedding call', async () => {
    process.env.HYBRID_SEARCH_ENABLED = 'false';
    const spy = mock.method(embeddings, 'embedQuery', async () => qvec);
    const hybrid = await retrieveHybrid('refund window', CHUNKS, { tenantId: 't1' });
    assert.deepEqual(hybrid, retrieve('refund window', CHUNKS, { tenantId: 't1' }));
    assert.equal(spy.mock.callCount(), 0);
  });

  test('no tenantId ⇒ lexical only, no embedding call', async () => {
    const spy = mock.method(embeddings, 'embedQuery', async () => qvec);
    const hybrid = await retrieveHybrid('refund window', CHUNKS, {});
    assert.deepEqual(hybrid, retrieve('refund window', CHUNKS, {}));
    assert.equal(spy.mock.callCount(), 0);
  });

  test('a vector-search error degrades to the lexical result', async () => {
    stubQueryVec();
    mock.method(prisma, '$queryRaw', async () => { throw new Error('relation "DocumentChunk" does not exist'); });
    const hybrid = await retrieveHybrid('refund window', CHUNKS, { tenantId: 't1' });
    assert.deepEqual(hybrid, retrieve('refund window', CHUNKS, { tenantId: 't1' }));
  });
});
