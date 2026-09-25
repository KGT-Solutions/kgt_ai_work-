const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { notifyFlatResidents, notifyBuildingAdmins } = require('../utils/notifications');
const {
  emailFlatResidents,
  emailBuildingAdmins,
  vehicleStatusEmail,
  vehicleAdminEmail
} = require('../utils/emailNotify');
const router = express.Router();

const VALID_CATEGORIES = ['car', 'bike', 'scooter', 'ev', 'commercial', 'other'];
const VALID_STATUSES = ['submitted', 'in_progress', 'done'];

const CATEGORY_LABELS = {
  car: 'Car',
  bike: 'Bike',
  scooter: 'Scooter',
  ev: 'Electric vehicle',
  commercial: 'Commercial',
  other: 'Other'
};

const STATUS_LABELS = {
  submitted: 'Req submitted',
  in_progress: 'In progress',
  done: 'Done'
};

function mapVehicle(v) {
  return {
    id: v.id,
    buildingId: v.buildingId,
    userId: v.userId,
    flatId: v.flatId,
    category: v.category,
    categoryLabel: CATEGORY_LABELS[v.category] || v.category,
    makeModel: v.makeModel,
    registrationNumber: v.registrationNumber,
    color: v.color,
    gatePassStatus: v.gatePassStatus,
    gatePassStatusLabel: STATUS_LABELS[v.gatePassStatus] || v.gatePassStatus,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    residentName: v.user?.name || null,
    flatNumber: v.flat?.number || null
  };
}

router.get('/', requireRole('resident'), async (req, res) => {
  if (!req.membership.flatId) {
    return res.status(400).json({ error: 'Flat assignment required' });
  }
  const vehicles = await prisma.vehicle.findMany({
    where: { buildingId: req.buildingId, flatId: req.membership.flatId },
    include: {
      user: { select: { name: true } },
      flat: { select: { number: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(vehicles.map(mapVehicle));
});

router.get('/manage', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { status, category } = req.query;
  const where = { buildingId: req.buildingId };
  if (status) where.gatePassStatus = status;
  if (category) where.category = category;

  const vehicles = await prisma.vehicle.findMany({
    where,
    include: {
      user: { select: { name: true, phone: true } },
      flat: { select: { number: true, wing: { select: { name: true } } } }
    },
    orderBy: [{ gatePassStatus: 'asc' }, { createdAt: 'desc' }]
  });

  res.json(vehicles.map((v) => ({
    ...mapVehicle(v),
    wing: v.flat?.wing?.name || null
  })));
});

router.get('/pending-count', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const count = await prisma.vehicle.count({
    where: {
      buildingId: req.buildingId,
      gatePassStatus: { in: ['submitted', 'in_progress'] }
    }
  });
  res.json({ count });
});

router.post('/', requireRole('resident'), async (req, res) => {
  const { category, makeModel, registrationNumber, color } = req.body;
  if (!category?.trim() || !makeModel?.trim() || !registrationNumber?.trim()) {
    return res.status(400).json({ error: 'category, makeModel and registrationNumber are required' });
  }
  if (!VALID_CATEGORIES.includes(category.trim())) {
    return res.status(400).json({ error: 'Invalid vehicle category' });
  }
  if (!req.membership.flatId) {
    return res.status(400).json({ error: 'Flat assignment required before registering a vehicle' });
  }

  const plate = registrationNumber.trim().toUpperCase();
  const duplicate = await prisma.vehicle.findFirst({
    where: { buildingId: req.buildingId, registrationNumber: plate }
  });
  if (duplicate) {
    return res.status(409).json({ error: 'This registration number is already registered in the society' });
  }

  const vehicle = await prisma.vehicle.create({
    data: {
      buildingId: req.buildingId,
      userId: req.user.id,
      flatId: req.membership.flatId,
      category: category.trim(),
      makeModel: makeModel.trim(),
      registrationNumber: plate,
      color: color?.trim() || null,
      gatePassStatus: 'submitted'
    },
    include: {
      user: { select: { name: true } },
      flat: { select: { number: true } }
    }
  });

  await notifyFlatResidents(prisma, req.buildingId, req.membership.flatId, {
    title: 'Gate pass request submitted',
    body: `${plate} · ${makeModel.trim()} — we will notify you when your gate pass is ready.`,
    category: 'vehicle'
  });

  await notifyBuildingAdmins(prisma, req.buildingId, {
    title: 'New gate pass request',
    body: `Flat ${vehicle.flat.number} · ${plate} · ${makeModel.trim()}`,
    category: 'vehicle'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailBuildingAdmins(
    prisma,
    req.buildingId,
    vehicleAdminEmail({
      flatNumber: vehicle.flat.number,
      plate,
      makeModel: makeModel.trim(),
      buildingId: req.buildingId,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(mapVehicle(vehicle));
});

router.patch('/:vehicleId/status', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { status } = req.body;
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be submitted, in_progress, or done' });
  }

  const existing = await prisma.vehicle.findFirst({
    where: { id: req.params.vehicleId, buildingId: req.buildingId },
    include: {
      user: { select: { name: true } },
      flat: { select: { number: true } }
    }
  });
  if (!existing) return res.status(404).json({ error: 'Vehicle not found' });

  const vehicle = await prisma.vehicle.update({
    where: { id: existing.id },
    data: { gatePassStatus: status },
    include: {
      user: { select: { name: true } },
      flat: { select: { number: true } }
    }
  });

  const statusMessage = status === 'done'
    ? 'Your gate pass has been issued.'
    : status === 'in_progress'
      ? 'Your gate pass request is being processed.'
      : 'Your gate pass request has been received.';

  await notifyFlatResidents(prisma, req.buildingId, existing.flatId, {
    title: `Gate pass · ${STATUS_LABELS[status]}`,
    body: `${vehicle.registrationNumber} · ${vehicle.makeModel} — ${statusMessage}`,
    category: 'vehicle'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailFlatResidents(
    prisma,
    req.buildingId,
    existing.flatId,
    vehicleStatusEmail({
      title: `Gate pass · ${STATUS_LABELS[status]}`,
      body: `${vehicle.registrationNumber} · ${vehicle.makeModel} — ${statusMessage}`,
      plate: vehicle.registrationNumber,
      makeModel: vehicle.makeModel,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(mapVehicle(vehicle));
});

module.exports = router;
