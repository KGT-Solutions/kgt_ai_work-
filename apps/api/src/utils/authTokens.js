const jwt = require('jsonwebtoken');

// Two kinds of session share one signing secret but can never stand in for
// each other: every token carries `typ`, and verifyToken() rejects any token
// whose typ isn't the one the route expects.
//   operator — KGT platform staff (middleware/operatorAuth.js)   { operatorId }
//   client   — a customer company's own login (clientAuth.js)    { tenantUserId }
// A client token deliberately carries no tenantId: the tenant is always
// looked up from the TenantUser row, so nothing in a token (or a request)
// can point a client at another company's data.

const DEV_JWT_SECRET = 'dev-secret-change-me'; // assertProdSafety refuses to boot production with this
// reset — short-lived proof that a password-reset code was verified
//         (routes/clientAuth.routes.js)  { tenantUserId, resetCodeId }
// signup — proof that a signup email was verified by OTP, presented to
//          /register/complete (services/verificationService.js)  { email, verificationId }
const TOKEN_TTL = { operator: '12h', client: '7d', reset: '10m', signup: '2h' };

function jwtSecret() {
  return process.env.JWT_SECRET || DEV_JWT_SECRET;
}

function signToken(typ, claims) {
  if (!TOKEN_TTL[typ]) throw new Error(`Unknown token type "${typ}"`);
  return jwt.sign({ ...claims, typ }, jwtSecret(), { expiresIn: TOKEN_TTL[typ] });
}

/** @returns the token's claims, or null if it's invalid, expired, or of another type */
function verifyToken(token, typ) {
  try {
    const claims = jwt.verify(token, jwtSecret());
    return claims.typ === typ ? claims : null;
  } catch {
    return null;
  }
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

module.exports = { signToken, verifyToken, bearer };
