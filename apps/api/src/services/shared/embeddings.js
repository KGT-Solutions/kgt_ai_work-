const crypto = require('crypto');
const { store } = require('../../lib/sharedStore');

// The semantic half of hybrid retrieval: turns text into vectors via OpenAI's
// embeddings endpoint. Mirrors engine/llmClient.js on purpose — built-in fetch
// (no SDK), trimmed key read (an env file with CRLF line endings otherwise
// leaves a trailing "\r" that the provider rejects), a hard timeout, and
// OPENAI_BASE_URL so the test/e2e fake server can stand in.
//
// The cardinal rule here: embedding is BEST-EFFORT and must never throw into a
// retrieval or ingestion path. Every public function returns null (or an array
// of nulls) when the key is missing or the provider is unreachable, and the
// callers (hybridRetriever.js, chunkStore.js) fall back to lexical-only. A
// temporary OpenAI outage degrades search quality; it never fails a chat turn
// or a document save.

const DEFAULT_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536; // text-embedding-3-small; must match prisma vector(1536)
// A query's vector doesn't change, so cache it generously. Keyed by model too,
// so switching EMBEDDING_MODEL can't serve vectors of the wrong dimension.
const QUERY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// OpenAI accepts large batches; keep each request well under the token ceiling.
const MAX_BATCH = 96;
// text-embedding-3-small rejects any single input over ~8,192 tokens with a 400,
// which would fail the WHOLE batch (all nulls) and make a background sync retry
// that same doomed batch forever. Cap each input at a safe character length
// (~4 chars/token => ~8k tokens) before sending. Truncating costs a little recall
// on a very long section but keeps every chunk embeddable; the lexical path still
// sees the full text.
const MAX_EMBED_CHARS = 32000;

function readKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function model() {
  return String(process.env.EMBEDDING_MODEL || '').trim() || DEFAULT_MODEL;
}

/** Whether an embedding provider is configured at all. */
function isEmbeddingConfigured() {
  return !!readKey();
}

function baseUrl() {
  // Same base URL knob as llmClient so an OpenAI-compatible server (the e2e
  // fake) serves both chat and embeddings.
  return String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
}

function timeoutMs() {
  const t = Number(process.env.EMBEDDING_TIMEOUT_MS);
  if (Number.isFinite(t) && t > 0) return t;
  const llm = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(llm) && llm > 0 ? llm : 20000;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A valid finite-number vector of the expected dimension, or null. */
function validVector(vec) {
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null;
  for (let i = 0; i < vec.length; i++) {
    if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) return null;
  }
  return vec;
}

/**
 * Embeds a batch of texts in one request. Never throws: returns an array the
 * SAME length as `texts`, with null in every position on any failure (missing
 * key, timeout, non-2xx, malformed body, dimension mismatch) so callers can
 * align results to inputs and skip the nulls.
 * @param {string[]} texts
 * @returns {Promise<Array<number[]|null>>}
 */
async function embedBatch(texts) {
  const key = readKey();
  if (!key) return texts.map(() => null);
  // Cap each input so one oversized section can't 400 the whole batch. The result
  // array still aligns 1:1 with the original `texts`, so callers map it back unchanged.
  const inputs = texts.map((t) => String(t == null ? '' : t).slice(0, MAX_EMBED_CHARS));
  let res;
  try {
    res = await fetchWithTimeout(`${baseUrl()}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: model(), input: inputs })
    });
  } catch (err) {
    console.warn(`[embeddings] request failed: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
    return texts.map(() => null);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[embeddings] provider error ${res.status}: ${body.slice(0, 200)}`);
    return texts.map(() => null);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return texts.map(() => null);
  }
  // Response items carry an `index` into the input array; order by it rather
  // than trusting positional order.
  const out = texts.map(() => null);
  for (const item of data.data || []) {
    if (typeof item.index === 'number' && item.index >= 0 && item.index < out.length) {
      out[item.index] = validVector(item.embedding);
    }
  }
  return out;
}

/**
 * Embeds many texts, chunked into provider-sized batches. Preserves order and
 * length; any text that fails to embed comes back as null.
 * @param {string[]} texts
 * @returns {Promise<Array<number[]|null>>}
 */
async function embedTexts(texts) {
  if (!Array.isArray(texts) || !texts.length) return [];
  if (!readKey()) return texts.map(() => null);
  const out = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    // Sequential batches keep memory and provider pressure bounded; ingestion
    // is off the hot path, so latency here doesn't affect chat.
    // eslint-disable-next-line no-await-in-loop
    const part = await embedBatch(texts.slice(i, i + MAX_BATCH));
    out.push(...part);
  }
  return out;
}

function queryCacheKey(text) {
  const hash = crypto.createHash('sha256').update(`${model()}\u0000${text}`).digest('hex').slice(0, 32);
  return `emb:q:${hash}`;
}

/**
 * Embeds a single search query, cached in the shared store so repeat questions
 * (across replicas and later turns) don't re-hit the provider — the same
 * best-effort caching queryTranslation.js uses. Returns null when embeddings
 * are unavailable, which tells hybridRetriever to use lexical only.
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function embedQuery(text) {
  const q = String(text || '').trim();
  if (!q || !readKey()) return null;

  const cacheKey = queryCacheKey(q);
  try {
    const cached = await store().get(cacheKey);
    const valid = validVector(cached);
    if (valid) return valid;
  } catch { /* cache unavailable: fall through to a fresh embedding */ }

  const [vec] = await embedBatch([q]);
  if (vec) {
    store().set(cacheKey, vec, QUERY_CACHE_TTL_MS).catch(() => {}); // best-effort
  }
  return vec;
}

/** pgvector literal form of a vector, for $queryRaw/$executeRaw. */
function toSqlVector(vec) {
  return `[${vec.join(',')}]`;
}

module.exports = {
  isEmbeddingConfigured,
  embedTexts,
  embedQuery,
  toSqlVector,
  EMBEDDING_DIM,
  embeddingModelName: model
};
