// The one core chat controller every domain (FLATBRIZ support, FLATBRIZ
// sales, or a resold tenant in any industry) runs through. It knows nothing
// about buildings, bylaws, pricing objections, or a specific tenant's
// business — everything domain-specific arrives via the DomainProfile
// passed in (see domainProfile.js) and the action registry.
//
// Confidence gating, HITL ticketing, and usage tracking (engine/confidence.js,
// ticketing.js, usageTracking.js) are opt-in per profile — a profile that
// doesn't set minConfidence/ticketing/usageTracking behaves exactly as
// before. Today only the tenant profile (domains/tenantProfile.js) opts in;
// FLATBRIZ's own two profiles are untouched by this.

const { loadKnowledgeBase } = require('./knowledgeLoader');
const { retrieve } = require('./retriever');
const { buildSystemPrompt, buildUserPrompt, parseCitedExcerpt } = require('./promptBuilder');
const { tryActions } = require('./actionRegistry');
const { computeConfidence } = require('./confidence');
const { fileSupportTicket } = require('./ticketing');
const { logUsage } = require('./usageTracking');
const {
  generateAnswer,
  formatAttempts,
  ChatConfigError,
  ChatRateLimitError,
  ChatUpstreamError
} = require('./llmClient');

/**
 * @param {{ profile: import('./domainProfile').DomainProfile, query: string, ctx?: object }} params
 * @returns {Promise<object>} whatever shape profile.format*() returns — the
 *   engine doesn't dictate the response contract, each domain does.
 */
async function getEngineAnswer({ profile, query, ctx = {} }) {
  // 1. Domain actions get first refusal — a live data lookup or side effect
  //    that can answer directly, no RAG/LLM involved.
  const actionResult = await tryActions(profile, query, ctx);
  if (actionResult) {
    const result = profile.formatSuccess(actionResult.answer, [], { ...ctx, actionId: actionResult.actionId });
    await profile.onResult?.(result, query, ctx);
    return result;
  }

  // 2. Retrieval, scoped to this domain's own knowledge base. A profile
  //    supplies either a static knowledgeBasePath (filesystem, FLATBRIZ's
  //    manuals) or a resolveKnowledge(ctx) function (DB-backed, per-tenant
  //    documents) — the engine doesn't care which.
  const allChunks = profile.resolveKnowledge
    ? await profile.resolveKnowledge(ctx)
    : loadKnowledgeBase(profile.knowledgeBasePath);
  const chunks = profile.filterChunks ? profile.filterChunks(allChunks, ctx) : allChunks;
  const ranked = retrieve(query, chunks, {
    topK: profile.topK,
    minScore: profile.minScore,
    boostTags: profile.boostTags?.(ctx, query),
    chunkWeight: profile.chunkWeight ? (chunk) => profile.chunkWeight(chunk, ctx, query) : undefined,
    relativeMinScore: profile.relativeMinScore
  });

  // Normalized 0-1 confidence, independent of the raw lexical score above —
  // only enforced as a gate for profiles that set minConfidence, so
  // existing behavior (gate on "zero relevant chunks") is unchanged for
  // profiles that don't opt in. Computed from the best UNWEIGHTED score:
  // chunkWeight decides which excerpts the model sees first, but must never
  // be able to lift a weak match over the anti-hallucination gate (or sink
  // a strong one under it).
  const topRawScore = ranked.length ? Math.max(...ranked.map((r) => r.rawScore ?? r.score)) : 0;
  const confidence = ranked.length ? computeConfidence(query, topRawScore) : 0;
  const gateFailed = !ranked.length || (profile.minConfidence != null && confidence < profile.minConfidence);

  if (gateFailed) {
    const result = profile.formatFallback(ctx, confidence);
    await profile.onResult?.(result, query, ctx);
    if (profile.ticketing) await fileSupportTicket({ profile, query, confidence, ctx });
    return result;
  }

  // 3. LLM call, guarded by the domain's own persona/rules.
  try {
    const { text, provider, model, usage } = await generateAnswer({
      systemPrompt: buildSystemPrompt(profile, ctx),
      userPrompt: buildUserPrompt(profile, query, ranked)
    });

    if (profile.usageTracking) await logUsage({ profile, ctx, provider, model, usage });

    // The model self-reports which excerpt it actually grounded its answer
    // in (see promptBuilder.citationInstruction) — trust that over rank[0]
    // when it's present and valid, since a near-tie in lexical scoring can
    // rank the wrong section first even though the model correctly drew from
    // a lower-ranked one.
    const { answerText, citedIndex } = parseCitedExcerpt(text.trim(), ranked.length);
    const noAnswer = answerText === profile.noAnswerSentinel;
    const effectiveRanked =
      citedIndex != null ? [ranked[citedIndex], ...ranked.filter((_, i) => i !== citedIndex)] : ranked;
    const result = noAnswer ? profile.formatFallback(ctx, confidence) : profile.formatSuccess(answerText, effectiveRanked, ctx);
    await profile.onResult?.(result, query, ctx);

    if (noAnswer && profile.ticketing) {
      await fileSupportTicket({ profile, query, confidence, ctx });
    }
    return result;
  } catch (err) {
    // Graceful degradation: a relevant chunk exists even if the LLM call
    // itself failed (missing key, rate limit, upstream error) — hand it
    // back directly rather than erroring out.
    if (
      err instanceof ChatConfigError ||
      err instanceof ChatRateLimitError ||
      err instanceof ChatUpstreamError
    ) {
      // Previously silent — a missing/invalid key looked identical to a
      // working bot with a bad knowledge base. One line per degraded answer,
      // naming every provider tried (never key values).
      console.error(
        `[chatEngine] ${profile.id}: LLM unavailable, served degraded answer — ` +
        (err.attempts?.length ? formatAttempts(err.attempts) : `${err.name}: ${err.message}`)
      );
      const result = profile.formatDegraded(ranked, ctx);
      await profile.onResult?.(result, query, ctx);
      return result;
    }
    throw err;
  }
}

module.exports = { getEngineAnswer };
