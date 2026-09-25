const { getEngineAnswer } = require('../../engine/chatEngine');
const { flatbrizSupportProfile, OUT_OF_SCOPE_MESSAGE } = require('../../domains/flatbrizSupport.profile');

/**
 * @param {{ query: string, userRole: 'resident'|'admin'|'guard', buildingId?: string, userId?: string }} params
 * @returns {Promise<{ answer: string, sourceSection: string|null }>}
 */
async function getSupportAnswer({ query, userRole, buildingId, userId }) {
  return getEngineAnswer({
    profile: flatbrizSupportProfile,
    query,
    ctx: { userRole, buildingId, userId }
  });
}

module.exports = { getSupportAnswer, OUT_OF_SCOPE_MESSAGE };
