// Dependency-free* lexical scoring shared by every bot's retriever
// (FLATBRIZ support/sales and every multi-tenant customer). Deliberately
// simple (weighted term-overlap, not embeddings) — good enough for a small,
// curated set of manual/knowledge-base chunks.
// (*one exception: Porter-stemming, see below — without it "return" and
// "returns" score as unrelated words, which is a real accuracy bug, not a
// style preference.)

const { stemmer } = require('porter-stemmer');

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of',
  'in', 'on', 'for', 'and', 'or', 'but', 'if', 'do', 'does', 'did', 'i',
  'you', 'my', 'me', 'it', 'this', 'that', 'can', 'how', 'what', 'when',
  'where', 'why', 'who', 'with', 'as', 'at', 'by', 'from', 'not', 'no'
]);

// Stemming folds inflected forms (returns/returned/return, bills/bill,
// visitors/visitor) onto the same root, so a query and a document that use
// different grammatical forms of the same word still match. Applied after
// stopword filtering — stopwords are already in their base form, no need to
// stem words we're about to throw away anyway.
function tokenizeRaw(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function tokenize(text) {
  return tokenizeRaw(text).map((t) => stemmer(t));
}

// Query analysis keeps both the raw (unstemmed) and stemmed form of every
// term. The stem drives the normal fuzzy match (as before); the raw form
// drives the exact-match bonus below, which is what actually distinguishes
// a real hit from a stemming collision.
function analyzeQuery(query) {
  return tokenizeRaw(query).map((raw) => ({ raw, stem: stemmer(raw) }));
}

// ---------------------------------------------------------------------
// Typo tolerance, driven by the corpus itself rather than a hand-written
// dictionary: a query word that appears nowhere in the knowledge base (not
// even by stem) is corrected to the closest word that DOES appear, if one
// is within a small edit distance. So "protien" finds "protein" in a
// supplement store's docs, "mortage" finds "mortgage" in a lender's, and
// "subscripton" finds "subscription" in a SaaS tenant's — no per-industry
// word list to maintain, and a word the tenant never uses can't be
// "corrected" into a term that isn't there to match anyway.
//
// Guard rails against false corrections (a wrong correction is worse than
// none — it can push a wrong chunk past the confidence gate):
//   - only words of 5+ letters are corrected (short words have too many
//     one-edit neighbours: cart/card/care);
//   - max 1 edit (2 for words of 9+ letters), where swapping two adjacent
//     letters ("protien") counts as ONE edit;
//   - the correction must keep the first letter, unless the only edit is
//     an adjacent swap — real typos almost never change the first letter;
//   - a corrected term earns stem-match credit but never the exact-match
//     bonus, so a typo'd query scores a bit below the same query typed
//     correctly, rather than identically.
// ---------------------------------------------------------------------

const MIN_CORRECTABLE_LENGTH = 5;

function maxEditsFor(word) {
  return word.length >= 9 ? 2 : 1;
}

// Optimal-string-alignment distance (Levenshtein + adjacent transposition),
// abandoning early once every cell in a row exceeds `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prevPrev[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length];
}

function isAdjacentSwap(a, b) {
  if (a.length !== b.length) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

// Vocabulary per item array — the tenant/FLATBRIZ chunk caches hand back the
// same array object until invalidated, so this is built once per cache
// generation, not once per query.
const vocabularyCache = new WeakMap();

function getVocabulary(items) {
  let vocab = vocabularyCache.get(items);
  if (vocab) return vocab;
  const rawFreq = new Map();
  const stems = new Set();
  for (const item of items) {
    for (const raw of tokenizeRaw(`${item.title} ${item.content}`)) {
      rawFreq.set(raw, (rawFreq.get(raw) || 0) + 1);
      stems.add(stemmer(raw));
    }
  }
  vocab = { rawFreq, stems };
  vocabularyCache.set(items, vocab);
  return vocab;
}

function closestVocabularyWord(word, vocab) {
  const max = maxEditsFor(word);
  let best = null;
  for (const [candidate, freq] of vocab.rawFreq) {
    if (candidate.length < MIN_CORRECTABLE_LENGTH - 1 || /\d/.test(candidate)) continue;
    const d = editDistance(word, candidate, max);
    if (d > max) continue;
    if (candidate[0] !== word[0] && !(d === 1 && isAdjacentSwap(word, candidate))) continue;
    // Closest first; among equally close candidates, the one the knowledge
    // base uses most is the likelier intended word.
    if (!best || d < best.d || (d === best.d && freq > best.freq)) best = { candidate, d, freq };
  }
  return best && best.candidate;
}

/**
 * Replaces query terms that don't occur anywhere in `items` with their
 * closest in-corpus spelling (see the block comment above). Terms that do
 * occur, short terms, and numbers pass through untouched.
 * @param {Array<{ raw: string, stem: string }>} queryTerms
 * @param {Array<{ title: string, content: string }>} items
 * @returns {Array<{ raw: string, stem: string, corrected?: string }>}
 *   corrected holds the user's original spelling when a term was changed.
 */
function correctQueryTerms(queryTerms, items) {
  if (!items.length) return queryTerms;
  const vocab = getVocabulary(items);
  return queryTerms.map((term) => {
    const known = vocab.rawFreq.has(term.raw) || vocab.stems.has(term.stem);
    if (known || term.raw.length < MIN_CORRECTABLE_LENGTH || /\d/.test(term.raw)) return term;
    const fix = closestVocabularyWord(term.raw, vocab);
    return fix ? { raw: fix, stem: stemmer(fix), corrected: term.raw } : term;
  });
}

function termFrequencies(tokens) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}

/**
 * @param {Array<{ raw: string, stem: string }>} queryTerms
 * @param {{ title: string, content: string, tags?: string[] }} item
 * @param {{ titleWeight?: number, bodyCapPerTerm?: number, boostTags?: Set<string>, tagBonus?: number, exactBonus?: number }} [opts]
 * @returns {{ score: number, exactMatches: number }}
 */
function scoreItem(queryTerms, item, opts = {}) {
  const { titleWeight = 3, bodyCapPerTerm = 3, boostTags, tagBonus = 4, exactBonus = 2 } = opts;
  const titleRaw = new Set(tokenizeRaw(item.title));
  const titleStems = new Set(tokenize(item.title));
  const bodyRawFreq = termFrequencies(tokenizeRaw(item.content));
  const bodyStemFreq = termFrequencies(tokenize(item.content));

  let score = 0;
  let exactMatches = 0;

  for (const { raw, stem, corrected } of queryTerms) {
    // A literal match (the query's own word, not just its stem-family) is
    // strong evidence this section is actually about what was asked — worth
    // more than a stemmed-only hit, which can be a false-positive collision
    // (e.g. "register" vs. "registered [mobile number]" stemming to the same
    // root while referring to unrelated topics — login vs. vehicle
    // registration). This is domain-agnostic: it rewards exactness for
    // whatever entity the query names, in any knowledge base. A
    // typo-corrected term is, by definition, not the user's literal word —
    // it gets stem credit only.
    if (corrected) {
      if (titleStems.has(stem)) score += titleWeight;
      score += Math.min(bodyStemFreq.get(stem) || 0, bodyCapPerTerm);
      continue;
    }
    const titleExact = titleRaw.has(raw);
    if (titleExact) {
      score += titleWeight + exactBonus;
      exactMatches += 1;
    } else if (titleStems.has(stem)) {
      score += titleWeight;
    }

    const stemHits = Math.min(bodyStemFreq.get(stem) || 0, bodyCapPerTerm);
    score += stemHits;
    if ((bodyRawFreq.get(raw) || 0) > 0) {
      score += exactBonus;
      exactMatches += 1;
    }
  }

  if (boostTags && boostTags.size && Array.isArray(item.tags)) {
    const hits = item.tags.filter((t) => boostTags.has(t)).length;
    score += hits * tagBonus;
  }

  return { score, exactMatches };
}

/**
 * @template {{ title: string, content: string, tags?: string[] }} T
 * @param {string} query
 * @param {T[]} items
 * @param {{
 *   topK?: number, minScore?: number, boostTags?: Set<string>,
 *   itemWeight?: (item: T) => number, relativeMinScore?: number
 * }} [opts]
 *   itemWeight: multiplier applied to each item's score for ORDERING only
 *     (e.g. per-category weighting). minScore and the returned rawScore are
 *     always the unweighted lexical score, so a weight can reorder genuine
 *     matches but can never turn a non-match into one.
 *   relativeMinScore: drop results whose weighted score is below this
 *     fraction of the top result's — keeps a barely-related chunk from
 *     riding along into the LLM context just because topK had room.
 * @returns {Array<{ item: T, score: number, rawScore: number }>}
 */
function rankItems(query, items, opts = {}) {
  const { topK = 3, minScore = 2, boostTags, itemWeight, relativeMinScore = 0, typoTolerance = true } = opts;
  const analyzed = analyzeQuery(query);
  if (!analyzed.length) return [];
  const queryTerms = typoTolerance ? correctQueryTerms(analyzed, items) : analyzed;

  const ranked = items
    .map((item) => {
      const { score: rawScore, exactMatches } = scoreItem(queryTerms, item, { ...opts, boostTags });
      const weight = itemWeight ? itemWeight(item) : 1;
      return { item, rawScore, score: rawScore * weight, exactMatches };
    })
    .filter((entry) => entry.rawScore >= minScore && entry.score > 0)
    // Ties (common with short queries and stemming collisions) no longer
    // fall back to whichever chunk happened to appear first in the source
    // file — the chunk with more literal-word matches wins, since that's a
    // direct signal the other one was riding a stem collision.
    .sort((a, b) => b.score - a.score || b.exactMatches - a.exactMatches)
    .slice(0, topK);

  const floor = ranked.length ? ranked[0].score * relativeMinScore : 0;
  return ranked
    .filter((entry) => entry.score >= floor)
    .map(({ item, score, rawScore }) => ({ item, score, rawScore }));
}

module.exports = { tokenize, tokenizeRaw, scoreItem, rankItems, correctQueryTerms, editDistance };
