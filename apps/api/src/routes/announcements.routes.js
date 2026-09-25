const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { notifyAllResidents } = require('../utils/notifications');
const { emailAllResidents, announcementEmail } = require('../utils/emailNotify');
const router = express.Router();

router.get('/', requireRole('resident', 'building_admin', 'committee_member', 'guard'), async (req, res) => {
  const announcements = await prisma.announcement.findMany({
    where: { buildingId: req.buildingId },
    orderBy: [{ pinned: 'desc' }, { postedAt: 'desc' }]
  });
  res.json(announcements);
});

router.post('/', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { title, body, category, pinned } = req.body;
  const announcement = await prisma.announcement.create({
    data: { buildingId: req.buildingId, title, body, category: category || 'general', pinned: !!pinned }
  });

  const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;
  await notifyAllResidents(prisma, req.buildingId, {
    title,
    body: preview,
    category: 'announcement'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailAllResidents(
    prisma,
    req.buildingId,
    announcementEmail({
      title,
      body: preview,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(announcement);
});

module.exports = router;
