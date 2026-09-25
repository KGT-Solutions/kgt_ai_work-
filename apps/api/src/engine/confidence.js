const { tokenize } = require('../services/shared/lexicalSearch');

// Pillar 4 needs a real "30% similarity" gate, but our retriever is lexical,
// not vector — there's no natural cosine score to threshold.
//
// First attempt divided the raw score by (query term count × max per-term
// score) — theoretically clean, but it punished a genuinely good match for
// every filler word in the query that could never score against anything
// ("how many days do I have to return an item" has 5 content words after
// stopword removal, but "many" and "have" will never match a document no
// matter how relevant it is — a 5-term denominator on a 2-term real match
// caps confidence at 40% even for a perfect hit). Verified this in testing:
// a real match scored 6 (title hit + 2 body hits after stemming) but only
// reached 0.20 confidence — below the 0.30 gate — purely from denominator
// inflation, not because the match was actually weak.
//
// A saturating curve fixes this: confidence rises toward 1 as the raw score
// rises, without being divided by anything the query itself doesn't control.
// `k` is "the score of one fully-matched term" (title weight + body cap) —
// the same score a single strong hit already produces, so one solid match
// alone lands right around 0.5, and a query needs either one very strong
// match or several moderate ones to clear a typical 0.30 gate.

function computeConfidence(query, topScore, opts = {}) {
  const { titleWeight = 3, bodyCapPerTerm = 3, exactBonus = 2, saturationK } = opts;
  const terms = tokenize(query);
  if (!terms.length || topScore <= 0) return 0;

  // k must track lexicalSearch.scoreItem's actual per-term ceiling. Since the
  // exact-match bonus was added there (title exact + body exact can each add
  // exactBonus on top of titleWeight/bodyCapPerTerm), a single fully-matched
  // term can now score up to (titleWeight+exactBonus)+(bodyCapPerTerm+exactBonus)
  // — omitting exactBonus here would leave k stale at the pre-bonus ceiling,
  // inflating confidence for exact/tag-boosted matches and letting weaker
  // hits clear a profile's minConfidence gate too easily.
  const k = saturationK ?? titleWeight + bodyCapPerTerm + 2 * exactBonus;
  return Math.max(0, Math.min(1, topScore / (topScore + k)));
}

module.exports = { computeConfidence };
