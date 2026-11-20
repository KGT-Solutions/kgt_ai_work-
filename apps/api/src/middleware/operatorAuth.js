const prisma = require('../lib/prisma');
const { signToken, verifyToken, bearer } = require('../utils/authTokens');

// Operators are KGT platform staff who manage every tenant from the admin
// console (apps/web/pages/admin). Their tokens are typ "operator" and are
// issued only by routes/operatorAuth.routes.js; a client (tenant) token is
// rejected here even though it's signed with the same secret.

function signOperatorToken(operator) {
  return signToken('operator', { operatorId: operator.id });
}

async function requireOperator(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const claims = verifyToken(token, 'operator');
  if (!claims?.operatorId) return res.status(401).json({ error: 'Invalid or expired token' });
  try {
    const operator = await prisma.operator.findUnique({
      where: { id: claims.operatorId },
      select: { id: true, email: true, name: true, passwordChangedAt: true, active: true }
    });
    if (!operator) return res.status(401).json({ error: 'Invalid token' });
    // Kill-switch, mirroring middleware/clientAuth.js. A token issued before the
    // last password change is refused (JWT iat is whole-second resolution, so a
    // token minted in the same second as the change still counts as "before" it,
    // closing the same-second mint race).
    if (operator.passwordChangedAt && claims.iat <= Math.floor(operator.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ error: 'Your password was changed — please sign in again.' });
    }
    if (!operator.active) {
      return res.status(403).json({ error: 'This operator account has been deactivated.' });
    }
    const { passwordChangedAt, active, ...rest } = operator;
    req.operator = rest;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireOperator, signOperatorToken };
