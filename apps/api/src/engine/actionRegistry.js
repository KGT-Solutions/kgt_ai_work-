// Requirement 3: modular action handlers. An "action" is a piece of
// domain-specific logic (a live data lookup, a side effect) that can answer
// a query directly, bypassing retrieval + the LLM entirely — e.g. an order-status
// lookup needs live data, not retrieval. No tenant profile registers actions
// yet (their `actions` lists are empty); the registry is the extension point. The core engine (chatEngine.js) never imports an action
// implementation directly; it only knows the registry and the list of
// action ids a domain profile enables. Register actions with registerAction() at startup.

const registry = new Map(); // actionId -> { match(query, ctx), run(query, ctx) }

/**
 * @param {string} actionId
 * @param {{
 *   match: (query: string, ctx: object) => boolean,
 *   run: (query: string, ctx: object) => Promise<{ answer: string, [key: string]: any } | null>
 * }} definition
 */
function registerAction(actionId, definition) {
  registry.set(actionId, definition);
}

/**
 * Tries each action the domain profile has enabled, in order, and returns
 * the first one that both matches the query and produces a result. Returns
 * null if no enabled action fires — the caller (chatEngine) then falls
 * through to the normal RAG path.
 * @param {import('./domainProfile').DomainProfile} profile
 * @param {string} query
 * @param {object} ctx
 */
async function tryActions(profile, query, ctx) {
  for (const actionId of profile.actions || []) {
    const definition = registry.get(actionId);
    if (!definition) continue; // registered nowhere yet — skip, don't crash the chat
    if (!definition.match(query, ctx)) continue;

    const result = await definition.run(query, ctx);
    if (result) return { actionId, ...result };
  }
  return null;
}

/**
 * Looks up a registered action's definition directly — lets tests exercise
 * match()/run() in isolation without going through a full domain profile.
 * @param {string} actionId
 */
function getAction(actionId) {
  return registry.get(actionId);
}

module.exports = { registerAction, tryActions, getAction };
