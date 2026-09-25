const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const router = express.Router();

/** Inbox is always per-user (residents and admins alike). */
function notificationWhere(req) {
  return { buildingId: req.buildingId, userId: req.user.id };
}

router.get('/unread-count', requireRole('resident', 'guard', 'building_admin', 'committee_member'), async (req, res) => {
  const count = await prisma.notification.count({
    where: { ...notificationWhere(req), read: false }
  });
  res.json({ count });
});

router.get('/', requireRole('resident', 'guard', 'building_admin', 'committee_member'), async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: notificationWhere(req),
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  res.json(notifications);
});

router.patch('/read-all', requireRole('resident', 'guard', 'building_admin', 'committee_member'), async (req, res) => {
  await prisma.notification.updateMany({
    where: { ...notificationWhere(req), read: false },
    data: { read: true }
  });
  res.json({ ok: true });
});

router.patch('/:id/read', requireRole('resident', 'guard', 'building_admin', 'committee_member'), async (req, res) => {
  const notification = await prisma.notification.findFirst({
    where: { id: req.params.id, ...notificationWhere(req) }
  });
  if (!notification) return res.status(404).json({ error: 'Notification not found' });

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { read: true }
  });
  res.json(updated);
});

module.exports = router;
