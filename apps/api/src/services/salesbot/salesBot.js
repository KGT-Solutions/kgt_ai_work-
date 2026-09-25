const { getEngineAnswer } = require('../../engine/chatEngine');
const { flatbrizSalesProfile, OUT_OF_SCOPE_MESSAGE } = require('../../domains/flatbrizSales.profile');
const { classifyQuery } = require('./intent');

/**
 * @param {{ query: string, clientType: 'builder'|'rwa_president'|'committee_member' }} params
 * @returns {Promise<{ answer: string, keyBenefitsHighlighted: string[], suggestedFollowUp: string }>}
 */
async function getSalesAnswer({ query, clientType }) {
  const classification = classifyQuery(query);
  return getEngineAnswer({
    profile: flatbrizSalesProfile,
    query,
    ctx: { clientType, classification }
  });
}

module.exports = { getSalesAnswer, OUT_OF_SCOPE_MESSAGE };
