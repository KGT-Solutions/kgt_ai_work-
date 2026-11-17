const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const embeddings = require('../../src/services/shared/embeddings');
const { store } = require('../../src/lib/sharedStore');

const DIM = embeddings.EMBEDDING_DIM; // 1536
const vec = (fill = 0.1) => Array.from({ length: DIM }, () => fill);

// Shapes an OpenAI-style /embeddings response for the given vectors, with the
// out-of-order `index` field the real API can return.
function okResponse(vectors) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: vectors.map((embedding, index) => ({ index, embedding })) })
  };
}

describe('embeddings', () => {
  let savedKey;
  beforeEach(() => { savedKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key'; });
  afterEach(async () => {
    mock.restoreAll();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
    await store().reset();
  });

  test('isEmbeddingConfigured reflects the presence of a key', () => {
    assert.equal(embeddings.isEmbeddingConfigured(), true);
    delete process.env.OPENAI_API_KEY;
    assert.equal(embeddings.isEmbeddingConfigured(), false);
  });

  test('embedTexts returns one vector per input, ordered by response index', async () => {
    mock.method(global, 'fetch', async () => okResponse([vec(0.1), vec(0.2)]));
    const out = await embeddings.embedTexts(['a', 'b']);
    assert.equal(out.length, 2);
    assert.equal(out[0][0], 0.1);
    assert.equal(out[1][0], 0.2);
  });

  test('without a key, embedTexts returns nulls and makes no request', async () => {
    delete process.env.OPENAI_API_KEY;
    const spy = mock.method(global, 'fetch', async () => { throw new Error('should not be called'); });
    assert.deepEqual(await embeddings.embedTexts(['a', 'b']), [null, null]);
    assert.equal(spy.mock.callCount(), 0);
  });

  test('a provider error degrades to nulls (never throws)', async () => {
    mock.method(global, 'fetch', async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    assert.deepEqual(await embeddings.embedTexts(['a']), [null]);
  });

  test('a network failure degrades to nulls (never throws)', async () => {
    mock.method(global, 'fetch', async () => { throw new Error('ECONNREFUSED'); });
    assert.deepEqual(await embeddings.embedTexts(['a']), [null]);
  });

  test('a wrong-dimension vector is rejected as null', async () => {
    mock.method(global, 'fetch', async () => okResponse([[1, 2, 3]]));
    assert.deepEqual(await embeddings.embedTexts(['a']), [null]);
  });

  test('embedQuery caches, so a repeat makes no second request', async () => {
    const spy = mock.method(global, 'fetch', async () => okResponse([vec(0.5)]));
    const first = await embeddings.embedQuery('how much is the pro plan');
    const second = await embeddings.embedQuery('how much is the pro plan');
    assert.equal(first[0], 0.5);
    assert.deepEqual(second, first);
    assert.equal(spy.mock.callCount(), 1);
  });

  test('embedQuery returns null when embeddings are unavailable', async () => {
    delete process.env.OPENAI_API_KEY;
    assert.equal(await embeddings.embedQuery('anything'), null);
  });

  test('toSqlVector renders a pgvector literal', () => {
    assert.equal(embeddings.toSqlVector([0.1, 0.2, 0.3]), '[0.1,0.2,0.3]');
  });

  test('an oversized input is truncated to the char cap before sending (no 400 on huge sections)', async () => {
    let sentInput;
    mock.method(global, 'fetch', async (url, opts) => { sentInput = JSON.parse(opts.body).input; return okResponse([vec(0.1)]); });
    const [v] = await embeddings.embedTexts(['x'.repeat(50000)]);
    assert.ok(Array.isArray(v), 'still returns a vector for the (truncated) input');
    assert.equal(sentInput[0].length, 32000, 'input is capped at MAX_EMBED_CHARS before the API call');
  });

  test('a short input is sent unchanged', async () => {
    let sentInput;
    mock.method(global, 'fetch', async (url, opts) => { sentInput = JSON.parse(opts.body).input; return okResponse([vec(0.1)]); });
    await embeddings.embedTexts(['hello world']);
    assert.equal(sentInput[0], 'hello world');
  });
});
