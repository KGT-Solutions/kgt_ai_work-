const prisma = require('../lib/prisma');

// requireRole resolves the tenant (building) for this request from the route
// param, query string, or X-Building-Id header, then checks the caller has
// an approved membership in that building with one of the allowed roles.
// Super admins bypass the membership check (they aren't scoped to a single
// building) but req.buildingId is still attached when one is supplied.
function requireRole(...allowedRoleKeys) {
  return async (req, res, next) => {
    const buildingId = req.params.buildingId || req.query.buildingId || req.headers['x-building-id'];

    if (req.user.isSuperAdmin) {
      req.buildingId = buildingId;
      return next();
    }

    if (!buildingId) {
      return res.status(400).json({ error: 'Building context required (X-Building-Id header)' });
    }

    const membershipId = req.headers['x-membership-id'];
    let membership = null;

    if (membershipId) {
      membership = await prisma.membership.findFirst({
        where: { id: membershipId, userId: req.user.id, buildingId, status: 'approved' },
        include: { role: true }
      });
      if (!membership) {
        return res.status(403).json({ error: 'Invalid membership for this building' });
      }
    } else {
      membership = await prisma.membership.findFirst({
        where: {
          userId: req.user.id,
          buildingId,
          status: 'approved',
          ...(allowedRoleKeys.length ? { role: { key: { in: allowedRoleKeys } } } : {})
        },
        include: { role: true }
      });
    }

    if (!membership) {
      return res.status(403).json({ error: 'No approved membership for this building' });
    }
    if (allowedRoleKeys.length && !allowedRoleKeys.includes(membership.role.key)) {
      return res.status(403).json({ error: 'Insufficient role permissions' });
    }

    req.buildingId = buildingId;
    req.membership = membership;
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Super admin only' });
  next();
}

module.exports = { requireRole, requireSuperAdmin };
