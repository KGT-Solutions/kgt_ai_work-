// suggestedFollowUp is picked deterministically from a fixed set of CTAs,
// prioritized by what the query classification found — this keeps the
// follow-up on-brand and avoids the LLM inventing offers (discounts,
// timelines) that sales hasn't actually approved.

const OBJECTION_FOLLOW_UPS = {
  'objection:payment_gateway_lag':
    'Would it help to see a live example of how a UPI payment reconciles to a flat\'s ledger in real time?',
  'objection:adoption_friction':
    'Would a short one-page resident onboarding guide (for the security desk / notice board) help with rollout?',
  'objection:spreadsheet_migration':
    'Would you like to share your current flat list so we can scope what the opening-balance migration would look like?',
  'objection:pricing':
    'Can I get your approximate monthly collection amount so we can walk through the gateway-commission savings together?'
};

const CLIENT_TYPE_FOLLOW_UPS = {
  builder: 'Would you like a rollout plan tailored to your project\'s tower/phase structure?',
  rwa_president: 'Would you like a side-by-side cost comparison against what your society spends today?',
  committee_member: 'Would you like a one-page comparison sheet you can share with your managing committee?'
};

const BUYING_SIGNAL_FOLLOW_UP = 'Would you like to schedule a short call or live demo with our team?';
const DEFAULT_FOLLOW_UP = 'Would you like to schedule a quick call with our team to see FLATBRIZ in action?';

/**
 * @param {{
 *   clientType: 'builder'|'rwa_president'|'committee_member',
 *   objectionTags: string[],
 *   buyingSignals: string[]
 * }} params
 * @returns {string}
 */
function pickFollowUp({ clientType, objectionTags, buyingSignals }) {
  if (buyingSignals.length) return BUYING_SIGNAL_FOLLOW_UP;
  if (objectionTags.length) {
    const followUp = OBJECTION_FOLLOW_UPS[objectionTags[0]];
    if (followUp) return followUp;
  }
  return CLIENT_TYPE_FOLLOW_UPS[clientType] || DEFAULT_FOLLOW_UP;
}

module.exports = { pickFollowUp, DEFAULT_FOLLOW_UP };
