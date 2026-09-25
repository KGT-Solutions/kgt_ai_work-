const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { flatUserFilter } = require('../utils/flatScope');
const { notifyFlatResidents, notifyBuildingAdmins } = require('../utils/notifications');
const {
  emailFlatResidents,
  emailUser,
  emailBuildingAdmins,
  facilityDecisionEmail,
  facilityBookingAdminEmail
} = require('../utils/emailNotify');
const router = express.Router();

const BOOKING_INCLUDE = {
  user: { select: { id: true, name: true, phone: true } },
  facility: { select: { id: true, name: true, pricePerHour: true } }
};

function parseDayRange(dateStr) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  return { dayStart, dayEnd };
}

function bookingsOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

router.get('/', requireRole('resident', 'building_admin', 'committee_member'), async (req, res) => {
  const where = { buildingId: req.buildingId, active: true };
  const facilities = await prisma.facility.findMany({ where, orderBy: { name: 'asc' } });
  res.json(facilities);
});

router.get('/manage', requireRole('building_admin'), async (req, res) => {
  const facilities = await prisma.facility.findMany({
    where: { buildingId: req.buildingId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { bookings: true } } }
  });
  res.json(facilities);
});

router.get('/bookings', requireRole('building_admin', 'resident'), async (req, res) => {
  const role = req.membership?.role?.key;
  const where = { facility: { buildingId: req.buildingId } };
  if (role === 'resident') Object.assign(where, await flatUserFilter(prisma, req));
  if (req.query.status) where.status = req.query.status;

  const bookings = await prisma.facilityBooking.findMany({
    where,
    include: BOOKING_INCLUDE,
    orderBy: { startTime: 'desc' },
    take: 100
  });
  res.json(bookings);
});

router.post('/', requireRole('building_admin'), async (req, res) => {
  const { name, icon, description, capacity, pricePerHour, active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const facility = await prisma.facility.create({
    data: {
      buildingId: req.buildingId,
      name: name.trim(),
      icon: icon?.trim() || null,
      description: description?.trim() || null,
      capacity: capacity != null ? Number(capacity) : null,
      pricePerHour: pricePerHour != null ? Number(pricePerHour) : null,
      active: active !== false
    }
  });
  res.json(facility);
});

router.patch('/bookings/:bookingId/cancel', requireRole('resident'), async (req, res) => {
  const existing = await prisma.facilityBooking.findFirst({
    where: {
      id: req.params.bookingId,
      facility: { buildingId: req.buildingId },
      status: { in: ['pending', 'approved'] },
      endTime: { gt: new Date() },
      ...(await flatUserFilter(prisma, req))
    },
    include: BOOKING_INCLUDE
  });
  if (!existing) return res.status(404).json({ error: 'Active booking not found' });

  const booking = await prisma.facilityBooking.update({
    where: { id: existing.id },
    data: { status: 'cancelled' },
    include: BOOKING_INCLUDE
  });

  await notifyBuildingAdmins(prisma, req.buildingId, {
    title: 'Facility booking cancelled',
    body: `${req.user.name} cancelled ${existing.facility.name} on ${existing.startTime.toLocaleString('en-IN')}.`,
    category: 'facility'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailBuildingAdmins(
    prisma,
    req.buildingId,
    facilityBookingAdminEmail({
      kind: 'cancel',
      residentName: req.user.name,
      facilityName: existing.facility.name,
      slotLabel: existing.startTime.toLocaleString('en-IN'),
      buildingId: req.buildingId,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(booking);
});

router.patch('/bookings/:bookingId', requireRole('building_admin'), async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }

  const existing = await prisma.facilityBooking.findFirst({
    where: {
      id: req.params.bookingId,
      facility: { buildingId: req.buildingId },
      status: 'pending'
    },
    include: { facility: true, user: { select: { id: true, name: true } } }
  });
  if (!existing) return res.status(404).json({ error: 'Pending booking not found' });

  if (status === 'approved') {
    const conflict = await prisma.facilityBooking.findFirst({
      where: {
        facilityId: existing.facilityId,
        id: { not: existing.id },
        status: { in: ['pending', 'approved'] },
        startTime: { lt: existing.endTime },
        endTime: { gt: existing.startTime }
      }
    });
    if (conflict) {
      return res.status(409).json({ error: 'This slot is no longer available' });
    }
  }

  const booking = await prisma.facilityBooking.update({
    where: { id: existing.id },
    data: { status },
    include: BOOKING_INCLUDE
  });

  const bookerMembership = await prisma.membership.findFirst({
    where: {
      userId: existing.userId,
      buildingId: req.buildingId,
      status: 'approved',
      role: { key: 'resident' }
    },
    select: { flatId: true }
  });

  const title = status === 'approved' ? 'Facility booking approved' : 'Facility booking declined';
  const body = status === 'approved'
    ? `Your booking for ${existing.facility.name} on ${existing.startTime.toLocaleString('en-IN')} has been approved.`
    : `Your booking request for ${existing.facility.name} was declined by the admin.`;

  if (bookerMembership?.flatId) {
    await notifyFlatResidents(prisma, req.buildingId, bookerMembership.flatId, { title, body, category: 'facility' });
  } else {
    await prisma.notification.create({
      data: { buildingId: req.buildingId, userId: existing.userId, title, body, category: 'facility' }
    });
  }

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  const facilityMail = facilityDecisionEmail({
    title,
    body,
    facilityName: existing.facility.name,
    buildingName: building?.name || 'Your society'
  });
  if (bookerMembership?.flatId) {
    await emailFlatResidents(prisma, req.buildingId, bookerMembership.flatId, facilityMail);
  } else {
    await emailUser(prisma, existing.userId, facilityMail);
  }

  res.json(booking);
});

router.patch('/:id', requireRole('building_admin'), async (req, res) => {
  const facility = await prisma.facility.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId }
  });
  if (!facility) return res.status(404).json({ error: 'Facility not found' });

  const { name, icon, description, capacity, pricePerHour, active } = req.body;
  const updated = await prisma.facility.update({
    where: { id: facility.id },
    data: {
      ...(name != null && { name: name.trim() }),
      ...(icon !== undefined && { icon: icon?.trim() || null }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(capacity !== undefined && { capacity: capacity != null ? Number(capacity) : null }),
      ...(pricePerHour !== undefined && { pricePerHour: pricePerHour != null ? Number(pricePerHour) : null }),
      ...(active !== undefined && { active: Boolean(active) })
    }
  });
  res.json(updated);
});

router.delete('/:id', requireRole('building_admin'), async (req, res) => {
  const facility = await prisma.facility.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId }
  });
  if (!facility) return res.status(404).json({ error: 'Facility not found' });

  await prisma.facilityBooking.deleteMany({ where: { facilityId: facility.id } });
  await prisma.facility.delete({ where: { id: facility.id } });
  res.json({ ok: true });
});

router.get('/:facilityId/availability', requireRole('resident', 'building_admin', 'committee_member'), async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

  const facility = await prisma.facility.findFirst({
    where: { id: req.params.facilityId, buildingId: req.buildingId, active: true }
  });
  if (!facility) return res.status(404).json({ error: 'Facility not found' });

  const { dayStart, dayEnd } = parseDayRange(date);
  const bookings = await prisma.facilityBooking.findMany({
    where: {
      facilityId: facility.id,
      status: { in: ['pending', 'approved'] },
      startTime: { lt: dayEnd },
      endTime: { gt: dayStart }
    },
    select: { id: true, startTime: true, endTime: true, status: true, userId: true }
  });
  res.json(bookings);
});

router.post('/:facilityId/bookings', requireRole('resident'), async (req, res) => {
  const { startTime, endTime } = req.body;
  if (!startTime || !endTime) return res.status(400).json({ error: 'startTime and endTime are required' });

  const facility = await prisma.facility.findFirst({
    where: { id: req.params.facilityId, buildingId: req.buildingId, active: true }
  });
  if (!facility) return res.status(404).json({ error: 'Facility not found' });

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return res.status(400).json({ error: 'Invalid booking time range' });
  }
  if (start <= new Date()) {
    return res.status(400).json({ error: 'Cannot book a time slot that has already started or passed' });
  }

  const conflict = await prisma.facilityBooking.findFirst({
    where: {
      facilityId: facility.id,
      status: { in: ['pending', 'approved'] },
      startTime: { lt: end },
      endTime: { gt: start }
    }
  });
  if (conflict) return res.status(409).json({ error: 'This time slot is already booked' });

  const booking = await prisma.facilityBooking.create({
    data: {
      facilityId: facility.id,
      userId: req.user.id,
      startTime: start,
      endTime: end,
      status: 'pending'
    },
    include: BOOKING_INCLUDE
  });

  const slotLabel = `${start.toLocaleDateString('en-IN')} ${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  await notifyBuildingAdmins(prisma, req.buildingId, {
    title: 'New facility booking request',
    body: `${req.user.name} requested ${facility.name} for ${slotLabel}`,
    category: 'facility'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailBuildingAdmins(
    prisma,
    req.buildingId,
    facilityBookingAdminEmail({
      kind: 'request',
      residentName: req.user.name,
      facilityName: facility.name,
      slotLabel,
      buildingId: req.buildingId,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(booking);
});

module.exports = router;
