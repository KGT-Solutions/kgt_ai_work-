const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { resolveFlatInBuilding } = require('../utils/flat');
const { optionalVisitorImage } = require('../middleware/upload');
const { emailUser, visitorResidentEmail } = require('../utils/emailNotify');
const router = express.Router();

router.get('/', requireRole('guard', 'building_admin', 'resident', 'committee_member'), async (req, res) => {
  const where = { buildingId: req.buildingId };
  const role = req.membership?.role?.key;
  if (role === 'resident') where.flatId = req.membership.flatId;

  const scope = req.query.scope || 'today';
  if (scope === 'today') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    where.entryTime = { gte: startOfToday };
  } else if (scope === 'week') {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    where.entryTime = { gte: start };
  } else if (scope === 'month') {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    where.entryTime = { gte: start };
  } else if (scope !== 'all' || role !== 'building_admin') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    where.entryTime = { gte: startOfToday };
  }

  const visitors = await prisma.visitorLog.findMany({
    where,
    include: { flat: { select: { number: true } } },
    orderBy: { entryTime: 'desc' },
    take: scope === 'all' ? 500 : 100
  });
  res.json(visitors);
});

/** Flat numbers for guard visitor form autocomplete. */
router.get('/flats', requireRole('guard', 'building_admin', 'committee_member'), async (req, res) => {
  const flats = await prisma.flat.findMany({
    where: { wing: { buildingId: req.buildingId } },
    select: { id: true, number: true, wing: { select: { name: true } } },
    orderBy: { number: 'asc' }
  });
  res.json(flats.map((f) => ({
    id: f.id,
    number: f.number,
    wing: f.wing.name,
    label: f.number
  })));
});

router.post('/', requireRole('guard'), optionalVisitorImage, async (req, res) => {
  const visitorName = (req.body.visitorName || '').trim();
  const purpose = (req.body.purpose || '').trim() || 'Guest';
  const flatNumber = (req.body.flatNumber || '').trim();
  const vehicleNumber = (req.body.vehicleNumber || '').trim() || null;

  if (!visitorName) return res.status(400).json({ error: 'visitorName is required' });
  if (!flatNumber) return res.status(400).json({ error: 'flatNumber is required' });

  const flatResult = await resolveFlatInBuilding(prisma, req.buildingId, flatNumber);
  if (flatResult.error) return res.status(404).json({ error: flatResult.error });
  const flat = flatResult.flat;

  const photoUrl = req.file ? `/uploads/visitors/${req.file.filename}` : null;

  const log = await prisma.visitorLog.create({
    data: {
      buildingId: req.buildingId,
      flatId: flat.id,
      visitorName,
      purpose,
      vehicleNumber,
      photoUrl,
      status: 'pending'
    },
    include: { flat: { select: { number: true } } }
  });

  const residents = await prisma.membership.findMany({
    where: { flatId: flat.id, buildingId: req.buildingId, status: 'approved', role: { key: 'resident' } },
    select: { userId: true }
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  const visitorMail = visitorResidentEmail({
    visitorName: log.visitorName,
    purpose: log.purpose,
    flatNumber: flat.number,
    buildingName: building?.name || 'Your society'
  });

  for (const { userId } of residents) {
    await prisma.notification.create({
      data: {
        buildingId: req.buildingId,
        userId,
        title: 'Visitor at gate',
        body: `${log.visitorName} (${log.purpose}) is waiting for your approval — Flat ${flat.number}`,
        category: 'visitor'
      }
    });
    await emailUser(prisma, userId, visitorMail);
  }

  res.json(log);
});

router.patch('/:id/respond', requireRole('resident'), async (req, res) => {
  const { action } = req.body;
  if (!['approve', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'action must be approve or decline' });
  }

  const visitor = await prisma.visitorLog.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId, flatId: req.membership.flatId, status: 'pending' }
  });
  if (!visitor) return res.status(404).json({ error: 'Pending visitor request not found' });

  const log = await prisma.visitorLog.update({
    where: { id: visitor.id },
    data: { status: action === 'approve' ? 'inside' : 'declined' },
    include: { flat: { select: { number: true } } }
  });
  res.json(log);
});

router.patch('/:id/exit', requireRole('guard'), async (req, res) => {
  const visitor = await prisma.visitorLog.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId, status: 'inside' }
  });
  if (!visitor) return res.status(404).json({ error: 'Visitor not inside or not found' });

  const log = await prisma.visitorLog.update({
    where: { id: visitor.id },
    data: { status: 'exited', exitTime: new Date() },
    include: { flat: { select: { number: true } } }
  });
  res.json(log);
});

module.exports = router;
