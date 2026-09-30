// In-memory LRU cache of LLM answers, so a repeated question costs nothing.
//
// Key: `${tenantId}:${botType}:${normalizedQuestion}`. Tenant and bot are
// both in every key, so a lookup can only ever reach entries written for the
// same tenant AND the same bot: Tenant A's answers are unreachable from
// Tenant B, and a Sales answer is never served to a Support question.
//
// Why caching the answer is safe: a bot's prompt is built only from the
// tenant's settings, its knowledge base and the question (promptBuilder.js
// does not include conversation history). So the cache is dropped for a
// tenant whenever either of those changes: invalidateTenantKnowledge()
// (every document add/edit/delete/import) and a tenant settings update both
// call invalidateTenant() here. A per-tenant generation counter stops an
// answer that was being generated while documents changed from being stored
// afterwards.
//
// Node runs this on one thread, so a Map needs no locking. The cache is per
// process: several API instances each keep their own (still correct, just
// fewer hits). Entries hold the raw model text plus what it cost, which is
// what a later hit reports as saved.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;
const MAX_QUESTION_KEY_LEN = 500;

function config() {
  const ttlHours = Number(process.env.ANSWER_CACHE_TTL_HOURS);
  const max = Number(process.env.ANSWER_CACHE_MAX_ENTRIES);
  return {
    enabled: String(process.env.ANSWER_CACHE_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    ttlMs: Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : DEFAULT_TTL_MS,
    maxEntries: Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_ENTRIES
  };
}

/**
 * Lowercase, Unicode-normalized, punctuation and symbols stripped, whitespace
 * collapsed: "What's your PRICING??" and "whats your pricing" share an entry.
 * Apostrophes are dropped rather than turned into spaces, so "what's" and
 * "whats" match. Digits are kept: "plan 2" and "plan 3" stay different.
 */
function normalizeQuestion(question) {
  return String(question || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUESTION_KEY_LEN);
}

class AnswerCache {
  constructor() {
    this.entries = new Map(); // key -> { tenantId, value, expiresAt, generation }; Map order = LRU order
    this.byTenant = new Map(); // tenantId -> Set<key>, for O(entries of that tenant) invalidation
    this.generations = new Map(); // tenantId -> number, bumped on invalidation
    this.stats = { hits: 0, misses: 0, stores: 0, evictions: 0, invalidations: 0 };
  }

  static key(tenantId, botType, question) {
    const normalized = normalizeQuestion(question);
    if (!tenantId || !botType || !normalized) return null;
    return `${tenantId}:${botType}:${normalized}`;
  }

  generation(tenantId) {
    return this.generations.get(tenantId) || 0;
  }

  /**
   * @returns {{ value: object, generation: number } | { value: null, generation: number }}
   *   generation must be handed back to set(), which ignores it if the
   *   tenant's knowledge changed in between.
   */
  get(tenantId, botType, question) {
    const generation = this.generation(tenantId);
    const { enabled } = config();
    const key = AnswerCache.key(tenantId, botType, question);
    if (!enabled || !key) return { value: null, generation };

    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now() || entry.generation !== generation) {
      if (entry) this.delete(key);
      this.stats.misses += 1;
      return { value: null, generation };
    }
    // Refresh recency: re-inserting moves the key to the end of the Map.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.stats.hits += 1;
    return { value: entry.value, generation };
  }

  set(tenantId, botType, question, value, generation) {
    const { enabled, ttlMs, maxEntries } = config();
    const key = AnswerCache.key(tenantId, botType, question);
    if (!enabled || !key) return false;
    if (generation !== this.generation(tenantId)) return false; // knowledge changed mid-call: this answer may be stale

    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { tenantId, value, expiresAt: Date.now() + ttlMs, generation });
    if (!this.byTenant.has(tenantId)) this.byTenant.set(tenantId, new Set());
    this.byTenant.get(tenantId).add(key);
    this.stats.stores += 1;

    while (this.entries.size > maxEntries) {
      this.delete(this.entries.keys().next().value); // least recently used
      this.stats.evictions += 1;
    }
    return true;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    const keys = this.byTenant.get(entry.tenantId);
    if (keys) {
      keys.delete(key);
      if (!keys.size) this.byTenant.delete(entry.tenantId);
    }
  }

  /** Drops every cached answer for one tenant (both bots). */
  invalidateTenant(tenantId) {
    this.generations.set(tenantId, this.generation(tenantId) + 1);
    for (const key of this.byTenant.get(tenantId) || []) this.entries.delete(key);
    this.byTenant.delete(tenantId);
    this.stats.invalidations += 1;
  }

  clear() {
    this.entries.clear();
    this.byTenant.clear();
    this.generations.clear();
    this.stats = { hits: 0, misses: 0, stores: 0, evictions: 0, invalidations: 0 };
  }

  describe() {
    return { ...config(), size: this.entries.size, tenants: this.byTenant.size, ...this.stats };
  }
}

// One shared instance per process.
const answerCache = new AnswerCache();

module.exports = { answerCache, AnswerCache, normalizeQuestion };
