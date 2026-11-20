const prisma = require('../lib/prisma');
const { hashPassword } = require('../utils/password');

// Reusable operator-account management, so the revocation kill-switch in
// middleware/operatorAuth.js always has its fields written consistently:
//   - changing a password stamps passwordChangedAt, which refuses every operator
//     token minted before the change on its next request;
//   - deactivating flips active=false, which locks the account out immediately
//     (the middleware re-reads the row every request, so there is no cached-token
//     bypass).
// Callable from the seed, a CLI (scripts/operator-admin.js), or a future admin
// route — the enforcement already lives in the middleware.

const MIN_PASSWORD_LENGTH = 10;

/**
 * Sets a new password AND stamps passwordChangedAt, signing out older sessions.
 * @param {string} operatorId
 * @param {string} newPassword
 */
async function changeOperatorPassword(operatorId, newPassword) {
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Operator password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return prisma.operator.update({
    where: { id: operatorId },
    data: { passwordHash: hashPassword(newPassword), passwordChangedAt: new Date() }
  });
}

/**
 * Enables or disables an operator account. A disabled operator is refused on its
 * next request even if it holds a still-unexpired token.
 * @param {string} operatorId
 * @param {boolean} active
 */
async function setOperatorActive(operatorId, active) {
  return prisma.operator.update({ where: { id: operatorId }, data: { active: !!active } });
}

const deactivateOperator = (operatorId) => setOperatorActive(operatorId, false);
const reactivateOperator = (operatorId) => setOperatorActive(operatorId, true);

module.exports = { changeOperatorPassword, setOperatorActive, deactivateOperator, reactivateOperator, MIN_PASSWORD_LENGTH };
