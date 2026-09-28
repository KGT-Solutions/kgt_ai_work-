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
      select: { id: true, email: true, name: true }
    });
    if (!operator) return res.status(401).json({ error: 'Invalid token' });
    req.operator = operator;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireOperator, signOperatorToken };
