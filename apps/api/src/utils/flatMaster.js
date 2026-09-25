async function getFlatMaster(prisma, buildingId, flatId) {
  if (!buildingId || !flatId) return null;
  return prisma.membership.findFirst({
    where: {
      buildingId,
      flatId,
      status: 'approved',
      isFlatMaster: true,
      role: { key: 'resident' }
    },
    include: { user: { select: { id: true, name: true, phone: true } } }
  });
}

async function ensureFlatMaster(prisma, buildingId, flatId) {
  const existing = await getFlatMaster(prisma, buildingId, flatId);
  if (existing) return existing;

  const first = await prisma.membership.findFirst({
    where: {
      buildingId,
      flatId,
      status: 'approved',
      role: { key: 'resident' }
    },
    orderBy: { user: { createdAt: 'asc' } },
    include: { user: { select: { id: true, name: true, phone: true } } }
  });

  if (!first) return null;

  if (!first.isFlatMaster) {
    return prisma.membership.update({
      where: { id: first.id },
      data: { isFlatMaster: true },
      include: { user: { select: { id: true, name: true, phone: true } } }
    });
  }

  return first;
}

function assertFlatMaster(req, res) {
  if (!req.membership?.isFlatMaster) {
    res.status(403).json({ error: 'Only the flat master user can perform this action' });
    return false;
  }
  return true;
}

module.exports = { getFlatMaster, ensureFlatMaster, assertFlatMaster };
