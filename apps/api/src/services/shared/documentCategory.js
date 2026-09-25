// The universal 3-tier TenantDocument taxonomy. Deliberately sector-neutral:
// every business — SaaS, real estate, e-commerce, a clinic — has "who we are
// and what we offer", "questions customers keep asking", and "the specific
// rules: prices, policies, terms, manuals". Mirrors the DocumentCategory
// enum in prisma/schema.prisma; the strings must stay identical.

const CATEGORIES = Object.freeze({
  CORE_OVERVIEW: 'CORE_OVERVIEW',
  FAQ: 'FAQ',
  CUSTOM_POLICY: 'CUSTOM_POLICY'
});

const CATEGORY_VALUES = Object.freeze(Object.values(CATEGORIES));
const DEFAULT_CATEGORY = CATEGORIES.CORE_OVERVIEW;

// Short labels shown to the LLM next to each excerpt, so it knows whether
// it's reading an FAQ answer, background copy, or a binding policy.
const CATEGORY_PROMPT_LABELS = Object.freeze({
  CORE_OVERVIEW: 'Company overview',
  FAQ: 'FAQ',
  CUSTOM_POLICY: 'Policy / pricing / manual'
});

function isValidCategory(value) {
  return CATEGORY_VALUES.includes(value);
}

/**
 * Validates a client-supplied category. `undefined`/null/'' -> the fallback
 * (so older clients that don't send one keep working); anything else must
 * be an exact enum value.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseCategory(value, fallback = DEFAULT_CATEGORY) {
  if (value === undefined || value === null || value === '') return { ok: true, value: fallback };
  const upper = String(value).trim().toUpperCase();
  if (isValidCategory(upper)) return { ok: true, value: upper };
  return { ok: false, error: `category must be one of ${CATEGORY_VALUES.join(', ')}` };
}

// Keyword signals for suggestCategory() below. Kept to words that mean
// the same thing in every industry — "pricing", "returns", "terms" — never
// sector vocabulary.
const FAQ_SIGNAL = /\b(faqs?|frequently[\s-]asked|questions|q-?and-?a|help[\s-]?cent(er|re)|support|troubleshoot\w*)\b/i;
const POLICY_SIGNAL =
  /\b(polic(y|ies)|terms|conditions|privacy|legal|pricing|prices?|plans?|fees?|rates?|shipping|delivery|returns?|refunds?|warranty|guarantee|cancell?ation|manual|guide|instructions|specs?|specifications|price[\s-]?(list|sheet)|brochure|catalog(ue)?|tariff)\b/i;

// An FAQ page is also recognisable by shape: several "## ...?" headings.
function looksLikeFaq(markdown) {
  const questionHeadings = String(markdown || '').match(/^##\s+[^\n]*\?\s*$/gm) || [];
  return questionHeadings.length >= 3;
}

/**
 * Best-effort default category for an ingested page — the visitor/admin
 * can always move it to another tab before it's saved.
 * @param {{ title?: string, url?: string|null, markdown?: string, source?: 'crawl'|'pdf' }} page
 */
function suggestCategory({ title = '', url = '', markdown = '', source = 'crawl' }) {
  let path = '';
  try {
    path = url ? decodeURIComponent(new URL(url).pathname).replace(/[/_.-]+/g, ' ').trim() : '';
  } catch {
    path = '';
  }
  // A site's homepage is its overview no matter what its <title> tagline
  // says ("Acme — Customer support software" is not an FAQ page).
  if (url && !path) return CATEGORIES.CORE_OVERVIEW;

  // URL path first: it's a deliberate information-architecture choice, while
  // titles often carry marketing taglines that mention "support" or "plans".
  if (FAQ_SIGNAL.test(path)) return CATEGORIES.FAQ;
  if (POLICY_SIGNAL.test(path)) return CATEGORIES.CUSTOM_POLICY;
  if (looksLikeFaq(markdown) || FAQ_SIGNAL.test(title)) return CATEGORIES.FAQ;
  if (POLICY_SIGNAL.test(title)) return CATEGORIES.CUSTOM_POLICY;
  // An uploaded PDF with no stronger signal is almost always a manual,
  // price sheet, or policy document rather than the company's overview.
  if (source === 'pdf') return CATEGORIES.CUSTOM_POLICY;
  return CATEGORIES.CORE_OVERVIEW;
}

module.exports = {
  CATEGORIES,
  CATEGORY_VALUES,
  CATEGORY_PROMPT_LABELS,
  DEFAULT_CATEGORY,
  isValidCategory,
  parseCategory,
  suggestCategory
};
