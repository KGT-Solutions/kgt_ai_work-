// Lightweight keyword-based intent recognition — no ML model needed. Detects
// which objection(s) a query touches (so retrieval can boost the matching KB
// chunks and the prompt can tell the LLM to address them head-on) and
// whether the query signals real buying intent (so leadCapture can decide
// whether to log/alert).

const OBJECTION_KEYWORDS = {
  'objection:payment_gateway_lag': [
    'gateway', 'settlement', 'lag', 'delay', 'delayed', 'reconcil', 'slow payment', 'takes days'
  ],
  'objection:adoption_friction': [
    'adopt', 'adoption', 'senior citizen', 'elderly', 'tech savvy', 'not tech', 'training',
    'wont use', "won't use", 'resist', 'another app', 'app fatigue', 'download'
  ],
  'objection:spreadsheet_migration': [
    'excel', 'spreadsheet', 'google sheet', 'migrat', 'switch from', 'current system',
    'existing data', 'whatsapp group', 'manual register'
  ],
  'objection:pricing': [
    'expensive', 'cost', 'pricing', 'price', 'budget', 'afford', 'cheaper', 'how much'
  ]
};

const COMPETITOR_KEYWORDS = {
  'competitor:mygate': ['mygate', 'my gate'],
  'competitor:nobroker': ['nobroker', 'no broker']
};

const BUYING_SIGNAL_KEYWORDS = [
  'sign up', 'signup', 'get started', 'demo', 'trial', 'onboard', 'onboarding',
  'contract', 'timeline', 'implementation', 'pilot', 'rollout', 'proposal',
  'how do we start', 'how do we switch', 'pricing plan', 'book a call', 'schedule a call'
];

function normalize(query) {
  return String(query || '').toLowerCase();
}

function matchKeywordGroups(normalizedQuery, groups) {
  const matched = [];
  for (const [tag, keywords] of Object.entries(groups)) {
    if (keywords.some((kw) => normalizedQuery.includes(kw))) matched.push(tag);
  }
  return matched;
}

/**
 * @param {string} query
 * @returns {{
 *   objectionTags: string[],
 *   competitorTags: string[],
 *   buyingSignals: string[],
 *   intentScore: number,
 *   isHighIntent: boolean
 * }}
 */
function classifyQuery(query) {
  const normalized = normalize(query);

  const objectionTags = matchKeywordGroups(normalized, OBJECTION_KEYWORDS);
  const competitorTags = matchKeywordGroups(normalized, COMPETITOR_KEYWORDS);
  const buyingSignals = BUYING_SIGNAL_KEYWORDS.filter((kw) => normalized.includes(kw));

  let score = 0;
  score += buyingSignals.length * 15;
  score += objectionTags.length * 5; // engaging with an objection = evaluating seriously
  score += competitorTags.length * 5; // actively comparing = evaluating seriously
  if (normalized.trim().length > 0) score += 2; // baseline for any real question
  score = Math.min(score, 100);

  const threshold = Number(process.env.INTENT_SCORE_THRESHOLD || 40);

  return {
    objectionTags,
    competitorTags,
    buyingSignals,
    intentScore: score,
    isHighIntent: score >= threshold
  };
}

module.exports = { classifyQuery };
