const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// Operators are platform staff who manage tenants from the console
// (apps/web). Their JWTs carry { operatorId } and are issued by
// routes/operatorAuth.routes.js. Tenant end users never get one — the chat
// API authenticates with a tenant API key instead (routes/tenantChat.routes.js).

const DEV_JWT_SECRET = 'dev-secret-change-me'; // assertProdSafety refuses to boot production with this

function jwtSecret() {
  return process.env.JWT_SECRET || DEV_JWT_SECRET;
}

function signOperatorToken(operator) {
  return jwt.sign({ operatorId: operator.id }, jwtSecret(), { expiresIn: '12h' });
}

async function requireOperator(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    const { operatorId } = jwt.verify(header.slice('Bearer '.length), jwtSecret());
    const operator = await prisma.operator.findUnique({
      where: { id: operatorId },
      select: { id: true, email: true, name: true }
    });
    if (!operator) return res.status(401).json({ error: 'Invalid token' });
    req.operator = operator;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireOperator, signOperatorToken };
