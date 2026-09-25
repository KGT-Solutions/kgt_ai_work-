const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { notifyBuildingAdmins } = require('../utils/notifications');
const { emailBuildingAdmins, sosAdminEmail } = require('../utils/emailNotify');
const router = express.Router();

router.get('/', requireRole('resident', 'guard', 'building_admin', 'committee_member'), async (req, res) => {
  const contacts = await prisma.emergencyContact.findMany({
    where: { buildingId: req.buildingId },
    orderBy: { name: 'asc' }
  });
  res.json(contacts);
});

router.post('/', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { name, phone, category } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: 'name and phone are required' });
  }
  const contact = await prisma.emergencyContact.create({
    data: {
      buildingId: req.buildingId,
      name: name.trim(),
      phone: phone.trim(),
      // Free-form contacts use "custom"; keep optional category for legacy emergency labels
      category: category?.trim() || 'custom'
    }
  });
  res.json(contact);
});

/** Active SOS alarms for gate / security dashboard (last 24h, unread). */
router.get('/sos/active', requireRole('guard', 'building_admin', 'committee_member'), async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const alerts = await prisma.notification.findMany({
    where: {
      buildingId: req.buildingId,
      category: 'sos',
      read: false,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  res.json(alerts);
});

router.post('/sos', requireRole('resident'), async (req, res) => {
  let flatNumber = null;
  if (req.membership?.flatId) {
    const flat = await prisma.flat.findUnique({
      where: { id: req.membership.flatId },
      select: { number: true }
    });
    flatNumber = flat?.number || null;
  }

  const body = flatNumber
    ? `${req.user.name} from Flat ${flatNumber} pressed the SOS alarm`
    : `${req.user.name} pressed the SOS alarm`;

  console.log(`[DEV] SOS triggered by ${req.user.name}${flatNumber ? ` (Flat ${flatNumber})` : ''} in building ${req.buildingId}`);

  await prisma.notification.create({
    data: {
      buildingId: req.buildingId,
      title: 'SOS Alert',
      body,
      category: 'sos'
    }
  });

  await notifyBuildingAdmins(prisma, req.buildingId, {
    title: 'SOS Alert',
    body,
    category: 'sos'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailBuildingAdmins(
    prisma,
    req.buildingId,
    sosAdminEmail({
      residentName: req.user.name,
      flatNumber,
      buildingId: req.buildingId,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json({ message: 'Security and trusted contacts have been alerted.' });
});

router.patch('/sos/:id/ack', requireRole('guard', 'building_admin', 'committee_member'), async (req, res) => {
  const alert = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      buildingId: req.buildingId,
      category: 'sos'
    }
  });
  if (!alert) return res.status(404).json({ error: 'SOS alert not found' });

  const updated = await prisma.notification.update({
    where: { id: alert.id },
    data: { read: true }
  });
  res.json(updated);
});

router.patch('/:contactId', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const existing = await prisma.emergencyContact.findFirst({
    where: { id: req.params.contactId, buildingId: req.buildingId }
  });
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  const { name, phone, category } = req.body;
  const contact = await prisma.emergencyContact.update({
    where: { id: existing.id },
    data: {
      ...(name != null && { name: String(name).trim() }),
      ...(phone != null && { phone: String(phone).trim() }),
      ...(category != null && { category: String(category).trim() })
    }
  });
  res.json(contact);
});

router.delete('/:contactId', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const existing = await prisma.emergencyContact.findFirst({
    where: { id: req.params.contactId, buildingId: req.buildingId }
  });
  if (!existing) return res.status(404).json({ error: 'Contact not found' });
  await prisma.emergencyContact.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

module.exports = router;
