async function getFlatMemberships(prisma, buildingId, flatId) {
  if (!buildingId || !flatId) return [];
  return prisma.membership.findMany({
    where: { buildingId, flatId, status: 'approved', role: { key: 'resident' } },
    select: { id: true, userId: true }
  });
}

async function getFlatResidentUserIds(prisma, buildingId, flatId) {
  const memberships = await getFlatMemberships(prisma, buildingId, flatId);
  return memberships.map((m) => m.userId);
}

async function getFlatMembershipIds(prisma, buildingId, flatId) {
  const memberships = await getFlatMemberships(prisma, buildingId, flatId);
  return memberships.map((m) => m.id);
}

/** Prisma filter: records owned by any approved resident on the same flat. */
async function flatUserFilter(prisma, req) {
  if (req.membership?.role?.key !== 'resident' || !req.membership.flatId) {
    return { userId: req.user.id };
  }
  const userIds = await getFlatResidentUserIds(prisma, req.buildingId, req.membership.flatId);
  return userIds.length ? { userId: { in: userIds } } : { userId: req.user.id };
}

/** Prisma filter: family members linked to any membership on the same flat. */
async function flatFamilyMemberFilter(prisma, req) {
  if (!req.membership?.flatId) {
    return { membershipId: req.membership.id };
  }
  const membershipIds = await getFlatMembershipIds(prisma, req.buildingId, req.membership.flatId);
  return membershipIds.length
    ? { membership: { flatId: req.membership.flatId, buildingId: req.buildingId } }
    : { membershipId: req.membership.id };
}

module.exports = {
  getFlatMemberships,
  getFlatResidentUserIds,
  getFlatMembershipIds,
  flatUserFilter,
  flatFamilyMemberFilter
};
