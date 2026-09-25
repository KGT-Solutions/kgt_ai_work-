const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { optionalComplaintImage } = require('../middleware/upload');
const { notifyUser, notifyBuildingAdmins } = require('../utils/notifications');
const {
  emailUser,
  emailBuildingAdmins,
  complaintStatusEmail,
  complaintAdminEmail
} = require('../utils/emailNotify');
const { flatUserFilter } = require('../utils/flatScope');
const router = express.Router();

router.get('/', requireRole('resident', 'building_admin', 'committee_member', 'guard'), async (req, res) => {
  const where = { buildingId: req.buildingId };
  if (req.membership?.role?.key === 'resident') Object.assign(where, await flatUserFilter(prisma, req));
  const complaints = await prisma.complaint.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          memberships: {
            where: { buildingId: req.buildingId, status: 'approved', role: { key: 'resident' } },
            include: { flat: { select: { number: true } } },
            take: 1
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json(complaints.map((c) => ({
    id: c.id,
    buildingId: c.buildingId,
    userId: c.userId,
    category: c.category,
    title: c.title,
    description: c.description,
    imageUrl: c.imageUrl,
    status: c.status,
    createdAt: c.createdAt,
    flatNumber: c.user.memberships[0]?.flat?.number || null,
    user: { id: c.user.id, name: c.user.name, phone: c.user.phone }
  })));
});

router.get('/open-count', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const count = await prisma.complaint.count({
    where: { buildingId: req.buildingId, status: { not: 'resolved' } }
  });
  res.json({ count });
});

router.post('/', requireRole('resident'), optionalComplaintImage, async (req, res) => {
  const { category, title, description } = req.body;
  const imageUrl = req.file ? `/uploads/complaints/${req.file.filename}` : null;
  const complaint = await prisma.complaint.create({
    data: {
      buildingId: req.buildingId,
      userId: req.user.id,
      category,
      title: title || category,
      description,
      imageUrl,
      status: 'submitted'
    }
  });

  const flatMembership = await prisma.membership.findFirst({
    where: {
      userId: req.user.id,
      buildingId: req.buildingId,
      status: 'approved',
      role: { key: 'resident' },
      flatId: { not: null }
    },
    include: { flat: { select: { number: true } } }
  });
  const flatLabel = flatMembership?.flat?.number ? `Flat ${flatMembership.flat.number}` : req.user.name || 'A resident';

  await notifyBuildingAdmins(prisma, req.buildingId, {
    title: 'New complaint',
    body: `${flatLabel} · ${complaint.title || complaint.category}`,
    category: 'complaint'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailBuildingAdmins(
    prisma,
    req.buildingId,
    complaintAdminEmail({
      flatLabel,
      title: complaint.title || complaint.category,
      buildingId: req.buildingId,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(complaint);
});

router.patch('/:id', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { status } = req.body;
  const existing = await prisma.complaint.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId }
  });
  if (!existing) return res.status(404).json({ error: 'Complaint not found' });

  const complaint = await prisma.complaint.update({ where: { id: existing.id }, data: { status } });

  const statusLabel = status.replace(/_/g, ' ');
  await notifyUser(prisma, {
    buildingId: req.buildingId,
    userId: existing.userId,
    title: `Complaint updated: ${statusLabel}`,
    body: `"${existing.title || existing.category}" is now ${statusLabel}.`,
    category: 'complaint'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailUser(
    prisma,
    existing.userId,
    complaintStatusEmail({
      title: existing.title || existing.category,
      statusLabel,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(complaint);
});

module.exports = router;
