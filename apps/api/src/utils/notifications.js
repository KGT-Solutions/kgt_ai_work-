async function notifyUser(prisma, { buildingId, userId, title, body, category }) {
  return prisma.notification.create({
    data: { buildingId, userId, title, body, category, read: false }
  });
}

async function notifyFlatResidents(prisma, buildingId, flatId, { title, body, category }) {
  const residents = await prisma.membership.findMany({
    where: { buildingId, flatId, status: 'approved', role: { key: 'resident' } },
    select: { userId: true }
  });
  for (const { userId } of residents) {
    await notifyUser(prisma, { buildingId, userId, title, body, category });
  }
}

async function notifyAllResidents(prisma, buildingId, { title, body, category }) {
  const residents = await prisma.membership.findMany({
    where: { buildingId, status: 'approved', role: { key: 'resident' } },
    select: { userId: true }
  });
  for (const { userId } of residents) {
    await notifyUser(prisma, { buildingId, userId, title, body, category });
  }
}

/** Notify building admins and committee members (actionable inbox). */
async function notifyBuildingAdmins(prisma, buildingId, { title, body, category }) {
  const admins = await prisma.membership.findMany({
    where: {
      buildingId,
      status: 'approved',
      role: { key: { in: ['building_admin', 'committee_member'] } }
    },
    select: { userId: true }
  });
  const seen = new Set();
  for (const { userId } of admins) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    await notifyUser(prisma, { buildingId, userId, title, body, category });
  }
}

module.exports = {
  notifyUser,
  notifyFlatResidents,
  notifyAllResidents,
  notifyBuildingAdmins
};
