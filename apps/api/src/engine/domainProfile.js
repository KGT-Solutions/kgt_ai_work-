// No runtime code — just the shape every domain profile must satisfy, kept
// in one place so src/domains/*.js and chatEngine.js agree on the contract.
//
// @typedef {object} DomainProfile
// @property {string} id                                    - e.g. "tenant:acme:support"
// @property {string} knowledgeBasePath                      - absolute dir of .md files (Requirement 2)
// @property {string[]} [actions]                            - action ids to try before RAG (Requirement 3)
// @property {number} [topK]                                 - retrieval candidates to keep (default 3)
// @property {number} [minScore]                              - below this, treated as "no relevant chunks" (default 2)
// @property {string} [excerptLabel]                          - e.g. "MANUAL EXCERPTS"
// @property {string} [replyReminder]                         - one must-follow reply rule, repeated after the question in the user prompt
// @property {string} [queryLabel]                             - e.g. "USER QUESTION"
// @property {(ctx: object) => string} systemPrompt            - persona + rules (Requirement 1)
// @property {string} noAnswerSentinel                          - exact token the model must emit when it can't answer
// @property {(ctx: object, query: string) => Set<string>|undefined} [boostTags] - optional retrieval tag boosting (e.g. mapping query synonyms to a chunk's `<!-- tags: ... -->`)
// @property {(chunk: object, ctx: object, query: string) => number} [chunkWeight] - optional score multiplier per chunk (e.g. by chunk.category); reorders matches only — minScore and confidence use the unweighted score
// @property {number} [relativeMinScore] - optional 0-1: drop retrieved chunks scoring below this fraction of the top chunk, so weak cross-topic matches don't pad the LLM context
// @property {(chunks: array, ctx: object) => array} [filterChunks] - optional per-request scoping (e.g. role-based access to a subset of files) applied right after load, before retrieval
// @property {(ctx: object) => Promise<array>} [resolveKnowledge] - alternative to knowledgeBasePath: DB-backed (or any other dynamic) chunk source
// @property {number} [minConfidence] - 0-1 gate on top of minScore (Pillar 4); unset = old zero-chunks-only gate, unchanged behavior
// @property {boolean} [ticketing] - file a SupportTicket (engine/ticketing.js) when the gate fails or the model can't answer; requires ctx.tenantId
// @property {boolean} [usageTracking] - log a UsageLog (engine/usageTracking.js) on every real LLM call and cache hit; requires ctx.tenantId
// @property {'support'|'sales'} [botType] - which bot this profile is; recorded on UsageLog rows and part of the answer-cache key
// @property {boolean} [answerCache] - re-use a recent answer to the same question (engine/answerCache.js); requires botType and ctx.tenantId
// @property {(ctx: object) => object} formatFallback            - out-of-scope / gate-failed response shape
// @property {(rawAnswer: string, rankedChunks: array, ctx: object) => object} formatSuccess
//   NOTE: rankedChunks is [] when the result came from an action handler
//   (chatEngine.js's action-success branch bypasses retrieval entirely) —
//   always guard rankedChunks[0] rather than assuming at least one chunk.
// @property {(rankedChunks: array, ctx: object) => object} formatDegraded - LLM unreachable, chunks found
// @property {(result: object, query: string, ctx: object) => (void|Promise<void>)} [onResult] - side effects (lead capture, etc.)

module.exports = {};
