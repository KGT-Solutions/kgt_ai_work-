const prisma = require('../lib/prisma');
const { signToken, verifyToken, bearer } = require('../utils/authTokens');

// A client company's session for its own dashboard. The tenant is resolved
// from the TenantUser row in the database, never from the token or the
// request, and attached as req.tenant — the only tenant any route behind
// this middleware can reach (routes/tenantWorkspace.routes.js reads nothing
// else). Operator tokens are rejected here.

function signClientToken(user) {
  return signToken('client', { tenantUserId: user.id });
}

const TENANT_FIELDS = {
  id: true, slug: true, name: true, industryLabel: true, persona: true, active: true,
  outOfScopeMessage: true, minConfidence: true, signupEmail: true, createdAt: true
};

async function requireClient(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const claims = verifyToken(token, 'client');
  if (!claims?.tenantUserId) return res.status(401).json({ error: 'Invalid or expired token' });
  try {
    const user = await prisma.tenantUser.findUnique({
      where: { id: claims.tenantUserId },
      select: { id: true, email: true, name: true, passwordChangedAt: true, tenant: { select: TENANT_FIELDS } }
    });
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    // Issued before the last password change (a reset elsewhere): sign in again.
    // JWT iat has 1-second resolution, so compare in whole seconds — and a
    // token from the reset's own second counts as before it, so no session
    // can slip through by being minted in the same second.
    if (user.passwordChangedAt && claims.iat <= Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ error: 'Your password was changed — please sign in again.' });
    }
    if (!user.tenant.active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact KGT support.' });
    }
    const { tenant, passwordChangedAt, ...tenantUser } = user;
    req.tenantUser = tenantUser;
    req.tenant = tenant;
    req.actor = 'client';
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireClient, signClientToken, TENANT_FIELDS };
