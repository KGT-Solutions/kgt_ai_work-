// Which bot may use a piece of knowledge. Every chunk of a tenant's
// documents (one "## " section) resolves to one of three scopes:
//   support  troubleshooting, how-to and setup, manuals, account help, FAQs,
//            hours and contact, returns / refunds / warranty / cancellation
//   sales    pricing, plans and tiers, feature lists, case studies,
//            comparisons, ROI, demos, why-choose-us pitches
//   both     company identity and anything without a clear lean
// The Support Bot retrieves support + both, the Sales Bot sales + both
// (domains/tenantProfile.js filterChunks), so the two bots behave as
// distinct specialists over one shared set of documents.
//
// A document's botScope (TenantDocument.botScope) decides how:
//   AUTO     each section is classified on its own by classifyChunk() below,
//            so a scraped page mixing pricing and FAQs splits correctly
//   BOTH / SUPPORT / SALES   every section goes to that scope (set by the
//            tenant in the Documents tab or the signup wizard)
// A "<!-- tags: bot:sales -->" comment under one heading overrides both
// (bot:support, bot:sales or bot:both), for a single mixed section.
//
// Deterministic keyword scoring, not an LLM call: it runs on every
// knowledge load, costs nothing, and gives the same answer every time. Ties
// and weak signals go to "both" — wrongly hiding a section from a bot is
// worse than letting both bots see it.

const SCOPES = Object.freeze({ SUPPORT: 'support', SALES: 'sales', BOTH: 'both' });
const DOC_SCOPES = Object.freeze(['AUTO', 'BOTH', 'SUPPORT', 'SALES']); // mirrors the BotScope enum in schema.prisma
const DEFAULT_DOC_SCOPE = 'AUTO';
const BOT_SCOPES = Object.freeze({ support: [SCOPES.SUPPORT, SCOPES.BOTH], sales: [SCOPES.SALES, SCOPES.BOTH] });

// Sector-neutral vocabulary only, like documentCategory.js.
const SUPPORT_TERMS = [
  /\btroubleshoot\w*/, /\b(not|isn'?t|doesn'?t|won'?t|can'?t|cannot) (work|load|open|connect|log ?in|sign ?in)\w*/,
  /\berror\w*/, /\bfix(es|ed|ing)?\b/, /\breset\b/, /\bpassword\b/, /\b(log|sign)[ -]?in\b/, /\baccount settings\b/,
  /\bhow (do|can|to)\b/, /\bstep[ -]by[ -]step\b/, /\bsteps?\b/, /\bset ?up\b/, /\binstall\w*/, /\bconfigur\w*/,
  /\bmanual\b/, /\buser guide\b/, /\binstructions?\b/, /\bfaqs?\b/, /\bhelp (cent(er|re)|desk)\b/,
  /\bsupport (team|hours|ticket|email|line)\b/, /\b(opening|business|office|working) hours\b/, /\bcontact (us|support)\b/,
  /\brefunds?\b/, /\breturns?\b/, /\bwarrant(y|ies)\b/, /\bcancel\w*/, /\breplace(ment)?\b/, /\brepairs?\b/,
  /\bslas?\b/, /\bservice level\b/, /\bmaintenance\b/, /\bupdate (your|the|my)\b/, /\bticket\b/
];
const SALES_TERMS = [
  /\bpric(e|es|ing)\b/, /\bplans?\b/, /\btiers?\b/, /\bpackages?\b/, /\bper (month|year|user|seat)\b/, /\/(mo|month|yr|year)\b/,
  /[$€£₹]\s?\d/, /\b\d[\d,.]*\s?(usd|inr|eur|gbp)\b/, /\bdiscount\w*/, /\bquote\b/, /\bfree trial\b/, /\bsubscription\b/,
  /\benterprise\b/, /\bdemo\b/, /\bcase stud(y|ies)\b/, /\btestimonials?\b/, /\bcustomer (stories|success stories)\b/,
  /\bcompar(e|ison|ed)\b/, /\bvs\.?\b/, /\balternatives?\b/, /\bwhy (choose|us)\b/, /\bbenefits?\b/, /\broi\b/,
  /\bfeatures?\b/, /\bkey features\b/, /\bspecifications?\b/, /\bspecs\b/, /\bsave (time|money)\b/, /\bget started\b/,
  /\bbook (a|your)\b/, /\bsign up\b/, /\bupgrade\b/, /\blicens(e|ing)\b/
];
const TITLE_WEIGHT = 3; // a heading is a deliberate statement of what the section is about
const MIN_SCORE = 2;
const MIN_LEAD = 1.5; // the winner must clearly lead, or the section stays "both"

const score = (text, terms) => terms.reduce((n, re) => n + (text.match(new RegExp(re.source, 'gi')) || []).length, 0);

/**
 * @param {{ title?: string, content?: string }} section
 * @returns {{ scope: 'support'|'sales'|'both', support: number, sales: number }}
 */
function scoreSection({ title = '', content = '' }) {
  const t = String(title).toLowerCase();
  const c = String(content).toLowerCase();
  const support = score(t, SUPPORT_TERMS) * TITLE_WEIGHT + score(c, SUPPORT_TERMS);
  const sales = score(t, SALES_TERMS) * TITLE_WEIGHT + score(c, SALES_TERMS);
  let scope = SCOPES.BOTH;
  if (support >= MIN_SCORE && support >= sales * MIN_LEAD) scope = SCOPES.SUPPORT;
  else if (sales >= MIN_SCORE && sales >= support * MIN_LEAD) scope = SCOPES.SALES;
  return { scope, support, sales };
}

const TAG_SCOPE = { 'bot:support': SCOPES.SUPPORT, 'bot:sales': SCOPES.SALES, 'bot:both': SCOPES.BOTH };

/**
 * The scope of one knowledge chunk.
 * @param {{ title?: string, content?: string, tags?: string[] }} chunk
 * @param {string} [docScope] the document's BotScope (AUTO when omitted)
 * @returns {'support'|'sales'|'both'}
 */
function classifyChunk(chunk, docScope = DEFAULT_DOC_SCOPE) {
  for (const tag of chunk.tags || []) {
    const scope = TAG_SCOPE[String(tag).trim().toLowerCase()];
    if (scope) return scope;
  }
  if (docScope && docScope !== 'AUTO' && DOC_SCOPES.includes(docScope)) return docScope.toLowerCase();
  return scoreSection(chunk).scope;
}

/**
 * Validates a client-supplied document botScope; empty -> the fallback.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseBotScope(value, fallback = DEFAULT_DOC_SCOPE) {
  if (value === undefined || value === null || value === '') return { ok: true, value: fallback };
  const upper = String(value).trim().toUpperCase();
  return DOC_SCOPES.includes(upper) ? { ok: true, value: upper } : { ok: false, error: `botScope must be one of ${DOC_SCOPES.join(', ')}` };
}

/** Whether a bot may use a chunk of this scope. */
const botCanUse = (botType, scope) => (BOT_SCOPES[botType] || []).includes(scope || SCOPES.BOTH);

/**
 * How a set of chunks splits between the bots.
 * @param {Array<{ scope?: string }>} chunks
 */
function scopeCounts(chunks) {
  const counts = { support: 0, sales: 0, both: 0 };
  for (const c of chunks) counts[c.scope in counts ? c.scope : 'both'] += 1;
  return { ...counts, supportBot: counts.support + counts.both, salesBot: counts.sales + counts.both, total: chunks.length };
}

module.exports = {
  SCOPES, DOC_SCOPES, DEFAULT_DOC_SCOPE, BOT_SCOPES, classifyChunk, scoreSection, parseBotScope, botCanUse, scopeCounts
};
