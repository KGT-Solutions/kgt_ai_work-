const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireSuperAdmin, requireRole } = require('../middleware/rbac');
const { hashPassword } = require('../utils/password');
const { normalizePhone } = require('../lib/phone');
const { inferFloorFromFlatNumber, normalizeFloorLetter } = require('../utils/flat');
const { normalizeBhkType } = require('../utils/bhk');
const { notifyUser } = require('../utils/notifications');
const { emailUser, membershipDecisionEmail } = require('../utils/emailNotify');
const router = express.Router();

const GUARD_DEFAULT_PASSWORD = 'Guard@123';

function generateBuildingCode(name) {
  const prefix = (name.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'BLD').toUpperCase();
  const suffix = crypto.randomInt(1000, 9999);
  return `${prefix}${suffix}`;
}

async function getBuildingAdminRole() {
  const role = await prisma.role.findUnique({ where: { key: 'building_admin' } });
  if (!role) throw new Error('building_admin role missing');
  return role;
}

function mapBuildingSummary(building) {
  return {
    id: building.id,
    name: building.name,
    address: building.address,
    city: building.city,
    buildingCode: building.buildingCode,
    subscriptionTier: building.subscriptionTier,
    createdAt: building.createdAt,
    wingCount: building._count?.wings ?? 0,
    memberCount: building._count?.memberships ?? 0,
    enabledFeatureCount: (building.features || []).filter((f) => f.isEnabled).length,
    admins: (building.memberships || []).map((m) => ({
      id: m.user.id,
      name: m.user.name,
      phone: m.user.phone,
      email: m.user.email,
      membershipId: m.id
    }))
  };
}

const buildingListInclude = {
  features: { include: { feature: true } },
  memberships: {
    where: {
      status: 'approved',
      role: { key: 'building_admin' }
    },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      role: { select: { key: true, name: true } }
    },
    orderBy: { user: { name: 'asc' } }
  },
  _count: {
    select: {
      memberships: true,
      wings: true
    }
  }
};

// Super Admin: list every onboarded society with building admins
router.get('/', requireSuperAdmin, async (req, res) => {
  const buildings = await prisma.building.findMany({
    include: buildingListInclude,
    orderBy: { createdAt: 'desc' }
  });
  res.json(buildings.map(mapBuildingSummary));
});

// Super Admin: onboard a new society - creates the building, optional empty
// wings, feature entitlements, and invites the nominated admin.
// Flats are NOT pre-generated — the building admin adds wings/ranges later.
router.post('/', requireSuperAdmin, async (req, res) => {
  const { name, address, city, subscriptionTier, numberOfWings, adminName, adminPhone, enabledFeatureKeys } = req.body;
  if (!name || !adminPhone) return res.status(400).json({ error: 'name and adminPhone are required' });

  const normalizedPhone = adminPhone.startsWith('+') ? adminPhone : `+91${adminPhone.replace(/\D/g, '')}`;

  const building = await prisma.building.create({
    data: { name, address, city, subscriptionTier: subscriptionTier || 'basic', buildingCode: generateBuildingCode(name) }
  });

  // Optional empty tower shells only (no flats).
  const wingCount = Math.min(Math.max(Number(numberOfWings) || 0, 0), 26);
  for (let i = 0; i < wingCount; i++) {
    await prisma.wing.create({
      data: { name: `Tower-${String(i + 1).padStart(2, '0')}`, buildingId: building.id }
    });
  }

  const allFeatures = await prisma.feature.findMany();
  const toEnable = new Set(enabledFeatureKeys && enabledFeatureKeys.length ? enabledFeatureKeys : allFeatures.map((f) => f.key));
  for (const feature of allFeatures) {
    await prisma.buildingFeature.create({
      data: { buildingId: building.id, featureId: feature.id, isEnabled: toEnable.has(feature.key) }
    });
  }

  let adminUser = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (!adminUser) adminUser = await prisma.user.create({ data: { name: adminName || 'Building Admin', phone: normalizedPhone } });
  else if (adminName) adminUser = await prisma.user.update({ where: { id: adminUser.id }, data: { name: adminName } });
  const adminRole = await prisma.role.findUnique({ where: { key: 'building_admin' } });
  await prisma.membership.create({
    data: { userId: adminUser.id, buildingId: building.id, roleId: adminRole.id, status: 'approved' }
  });

  console.log(`[DEV] Invite sent to ${normalizedPhone} - Building Code: ${building.buildingCode}`);
  res.json({
    building,
    message: 'Building created. Admin invited with the Building Code. Add flat ranges from the Flats page.'
  });
});

// Super Admin: create or update the building admin for a society
router.patch('/:buildingId/admin', requireSuperAdmin, async (req, res) => {
  const { buildingId } = req.params;
  const { adminName, adminPhone, adminEmail, membershipId } = req.body;

  if (!adminPhone) return res.status(400).json({ error: 'adminPhone is required' });

  const building = await prisma.building.findUnique({ where: { id: buildingId } });
  if (!building) return res.status(404).json({ error: 'Building not found' });

  const normalizedPhone = normalizePhone(adminPhone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid admin phone number' });

  const email = adminEmail?.trim() ? String(adminEmail).trim() : null;
  const name = (adminName || '').trim() || 'Building Admin';
  const adminRole = await getBuildingAdminRole();

  let adminUser = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: { name, phone: normalizedPhone, email }
    });
  } else {
    adminUser = await prisma.user.update({
      where: { id: adminUser.id },
      data: {
        name,
        ...(email !== null ? { email } : {})
      }
    });
  }

  const existingAdmins = await prisma.membership.findMany({
    where: {
      buildingId,
      status: 'approved',
      roleId: adminRole.id
    }
  });

  const targetMembership = membershipId
    ? existingAdmins.find((m) => m.id === membershipId)
    : existingAdmins[0];

  if (targetMembership) {
    if (targetMembership.userId !== adminUser.id) {
      const conflict = existingAdmins.find((m) => m.userId === adminUser.id && m.id !== targetMembership.id);
      if (conflict) {
        await prisma.membership.delete({ where: { id: targetMembership.id } });
      } else {
        await prisma.membership.update({
          where: { id: targetMembership.id },
          data: { userId: adminUser.id }
        });
      }
    }
  } else {
    const alreadyAdmin = existingAdmins.find((m) => m.userId === adminUser.id);
    if (!alreadyAdmin) {
      await prisma.membership.create({
        data: {
          userId: adminUser.id,
          buildingId,
          roleId: adminRole.id,
          status: 'approved'
        }
      });
    }
  }

  const refreshed = await prisma.building.findUnique({
    where: { id: buildingId },
    include: buildingListInclude
  });

  res.json({
    building: mapBuildingSummary(refreshed),
    message: 'Building admin updated'
  });
});

// Super Admin: permanently delete a building and all related society data
router.delete('/:buildingId', requireSuperAdmin, async (req, res) => {
  const { buildingId } = req.params;

  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    select: { id: true, name: true, buildingCode: true }
  });
  if (!building) return res.status(404).json({ error: 'Building not found' });

  try {
    await prisma.$transaction(async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { buildingId },
        select: { id: true }
      });
      const membershipIds = memberships.map((m) => m.id);

      if (membershipIds.length) {
        await tx.familyMember.deleteMany({ where: { membershipId: { in: membershipIds } } });
      }

      const bills = await tx.bill.findMany({
        where: { buildingId },
        select: { id: true }
      });
      const billIds = bills.map((b) => b.id);
      if (billIds.length) {
        await tx.paymentAllocation.deleteMany({ where: { billId: { in: billIds } } });
      }
      await tx.payment.deleteMany({ where: { buildingId } });
      await tx.bill.deleteMany({ where: { buildingId } });
      await tx.societyExpense.deleteMany({ where: { buildingId } });
      await tx.maintenanceConfig.deleteMany({ where: { buildingId } });

      const votes = await tx.vote.findMany({
        where: { buildingId },
        select: { id: true }
      });
      const voteIds = votes.map((v) => v.id);
      if (voteIds.length) {
        const options = await tx.voteOption.findMany({
          where: { voteId: { in: voteIds } },
          select: { id: true }
        });
        const optionIds = options.map((o) => o.id);
        if (optionIds.length) {
          await tx.voteResponse.deleteMany({ where: { voteOptionId: { in: optionIds } } });
          await tx.voteOption.deleteMany({ where: { id: { in: optionIds } } });
        }
        await tx.vote.deleteMany({ where: { buildingId } });
      }

      const facilities = await tx.facility.findMany({
        where: { buildingId },
        select: { id: true }
      });
      const facilityIds = facilities.map((f) => f.id);
      if (facilityIds.length) {
        await tx.facilityBooking.deleteMany({ where: { facilityId: { in: facilityIds } } });
        await tx.facility.deleteMany({ where: { buildingId } });
      }

      await tx.vehicle.deleteMany({ where: { buildingId } });
      await tx.visitorLog.deleteMany({ where: { buildingId } });
      await tx.complaint.deleteMany({ where: { buildingId } });
      await tx.announcement.deleteMany({ where: { buildingId } });
      await tx.marketplaceListing.deleteMany({ where: { buildingId } });
      await tx.emergencyContact.deleteMany({ where: { buildingId } });
      await tx.notification.deleteMany({ where: { buildingId } });
      await tx.buildingFeature.deleteMany({ where: { buildingId } });
      await tx.membership.deleteMany({ where: { buildingId } });

      const wings = await tx.wing.findMany({
        where: { buildingId },
        select: { id: true }
      });
      const wingIds = wings.map((w) => w.id);
      if (wingIds.length) {
        await tx.flat.deleteMany({ where: { wingId: { in: wingIds } } });
        await tx.wing.deleteMany({ where: { buildingId } });
      }

      await tx.building.delete({ where: { id: buildingId } });
    });
  } catch (e) {
    console.error('[buildings] delete failed', e);
    return res.status(500).json({ error: 'Failed to delete building. Related data may still be linked.' });
  }

  res.json({
    ok: true,
    deleted: {
      id: building.id,
      name: building.name,
      buildingCode: building.buildingCode
    }
  });
});

// Super Admin: toggle a single feature on/off for a building - this is the
// mechanism behind "add/remove service features on demand" from the brief.
router.patch('/:buildingId/features/:featureKey', requireSuperAdmin, async (req, res) => {
  const { buildingId, featureKey } = req.params;
  const { isEnabled } = req.body;
  const feature = await prisma.feature.findUnique({ where: { key: featureKey } });
  if (!feature) return res.status(404).json({ error: 'Unknown feature' });

  const updated = await prisma.buildingFeature.upsert({
    where: { buildingId_featureId: { buildingId, featureId: feature.id } },
    update: { isEnabled },
    create: { buildingId, featureId: feature.id, isEnabled }
  });
  res.json(updated);
});

// Building Admin: dashboard summary stats
router.get('/:buildingId/dashboard', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { buildingId } = req.params;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [building, flatsTotal, occupiedFlatRows, dueBills, openComplaints, todaysVisitors] = await Promise.all([
    prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, name: true, buildingCode: true, city: true, address: true }
    }),
    prisma.flat.count({ where: { wing: { buildingId } } }),
    prisma.membership.findMany({
      where: {
        buildingId,
        status: 'approved',
        role: { key: 'resident' },
        flatId: { not: null }
      },
      distinct: ['flatId'],
      select: { flatId: true }
    }),
    prisma.bill.findMany({
      where: { buildingId, status: { in: ['due', 'partial'] } },
      select: { amount: true, amountPaid: true }
    }),
    prisma.complaint.count({ where: { buildingId, status: { not: 'resolved' } } }),
    prisma.visitorLog.count({ where: { buildingId, entryTime: { gte: startOfToday } } })
  ]);

  if (!building) return res.status(404).json({ error: 'Building not found' });

  const duesPendingAmount = dueBills.reduce(
    (sum, b) => sum + Math.max(0, Number(b.amount) - Number(b.amountPaid || 0)),
    0
  );

  res.json({
    building,
    flatsTotal,
    flatsOccupied: occupiedFlatRows.length,
    duesPendingAmount: Math.round(duesPendingAmount * 100) / 100,
    duesPendingCount: dueBills.length,
    openComplaints,
    todaysVisitors
  });
});

// Flat occupancy with resident + vehicle details (admin, committee, guard)
router.get('/:buildingId/flats', requireRole('building_admin', 'committee_member', 'guard'), async (req, res) => {
  const buildingId = req.params.buildingId;
  const flats = await prisma.flat.findMany({
    where: { wing: { buildingId } },
    include: {
      wing: { select: { name: true } },
      vehicles: {
        select: { id: true, registrationNumber: true, makeModel: true, category: true }
      },
      memberships: {
        where: { status: 'approved', role: { key: 'resident' } },
        include: {
          user: { select: { id: true, name: true, phone: true } },
          familyMembers: { orderBy: { name: 'asc' } }
        }
      }
    },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }]
  });

  const residentUserIds = [...new Set(
    flats.flatMap((f) => f.memberships.map((m) => m.userId))
  )];
  const siblingMemberships = residentUserIds.length
    ? await prisma.membership.findMany({
        where: {
          buildingId,
          userId: { in: residentUserIds },
          status: 'approved',
          role: { key: 'resident' },
          flatId: { not: null }
        },
        include: { flat: { select: { id: true, number: true, floor: true } } }
      })
    : [];
  const siblingsByUser = siblingMemberships.reduce((acc, m) => {
    if (!acc[m.userId]) acc[m.userId] = [];
    acc[m.userId].push(m);
    return acc;
  }, {});

  res.json(flats.map((f) => ({
    id: f.id,
    number: f.number,
    floor: f.floor,
    bhkType: f.bhkType || null,
    wingId: f.wingId,
    wing: f.wing.name,
    occupied: f.memberships.length > 0,
    hasVehicle: f.vehicles.length > 0,
    vehicles: f.vehicles.map((v) => ({
      id: v.id,
      registrationNumber: v.registrationNumber,
      makeModel: v.makeModel,
      category: v.category
    })),
    residents: f.memberships.map((m) => {
      const alsoOwns = (siblingsByUser[m.userId] || [])
        .filter((s) => s.flatId !== f.id)
        .map((s) => ({
          flatId: s.flatId,
          flatNumber: s.flat?.number || null,
          floor: s.flat?.floor ?? null
        }));
      return {
        membershipId: m.id,
        userId: m.userId,
        name: m.user.name,
        phone: m.user.phone,
        alsoOwns,
        familyMembers: m.familyMembers.map((fm) => ({
          id: fm.id,
          name: fm.name,
          relation: fm.relation,
          phone: fm.phone,
          status: fm.status
        }))
      };
    })
  })));
});

function wingCodeFromName(name) {
  const tower = String(name || '').match(/tower[-\s]*(\d+)/i);
  if (tower) return tower[1];
  const wingLetter = String(name || '').match(/^wing\s+([A-Z])$/i);
  if (wingLetter) return String(wingLetter[1].toUpperCase().charCodeAt(0) - 64);
  return '1';
}

function formatWingName(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  let num = null;
  const towerMatch = raw.match(/^(?:wing\s+)?tower[-\s]*(\d+)$/i)
    || raw.match(/^tower[-\s]*(\d+)$/i)
    || raw.match(/^(\d+)$/);
  if (towerMatch) num = parseInt(towerMatch[1], 10);

  if (num == null) {
    const wingLetter = raw.match(/^wing\s+([A-Z])$/i);
    if (wingLetter) num = wingLetter[1].toUpperCase().charCodeAt(0) - 64;
  }

  if (num != null && num >= 1 && num <= 99) {
    return `Tower-${String(num).padStart(2, '0')}`;
  }

  return null;
}

// List towers (empty shells included)
router.get('/:buildingId/wings', requireRole('building_admin', 'committee_member', 'guard'), async (req, res) => {
  const wings = await prisma.wing.findMany({
    where: { buildingId: req.params.buildingId },
    include: { _count: { select: { flats: true } } },
    orderBy: { name: 'asc' }
  });
  res.json(wings.map((w) => ({
    id: w.id,
    name: w.name,
    code: wingCodeFromName(w.name),
    flatCount: w._count.flats
  })));
});

// Add a tower (e.g. "Tower-1", "Tower-02", "1")
router.post('/:buildingId/wings', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const name = formatWingName(req.body.name || req.body.code);
  if (!name) return res.status(400).json({ error: 'Tower name is required (e.g. Tower-01 or 1)' });

  const existing = await prisma.wing.findFirst({
    where: { buildingId: req.params.buildingId, name }
  });
  if (existing) return res.status(400).json({ error: `${name} already exists` });

  const wing = await prisma.wing.create({
    data: { name, buildingId: req.params.buildingId }
  });
  res.json({ id: wing.id, name: wing.name, code: wingCodeFromName(wing.name), flatCount: 0 });
});

// Body: { wingId? | wingName?, floorLetter?, start?, end?, numbers?, floorMode?, floor?, floors?, bhkType?, bhkTypes? }
// floorLetter: A–Z prefix for flat numbers (A-101). Defaults to A.
// bhkType: "1bhk" | "2bhk" | "3bhk" applied to all new flats
// bhkTypes: map or parallel array for custom mode
router.post('/:buildingId/flats/range', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const buildingId = req.params.buildingId;
  const { wingId, wingName, start, end, numbers, floorMode, floor, floors, bhkType, bhkTypes, floorLetter } = req.body;

  let wing = null;
  if (wingId) {
    wing = await prisma.wing.findFirst({ where: { id: wingId, buildingId } });
  } else if (wingName) {
    const name = formatWingName(wingName);
    wing = await prisma.wing.findFirst({ where: { buildingId, name } });
    if (!wing && name) {
      wing = await prisma.wing.create({ data: { name, buildingId } });
    }
  }
  if (!wing) return res.status(400).json({ error: 'towerId or towerName is required' });

  const prefix = normalizeFloorLetter(floorLetter);
  const toCreate = [];

  if (Array.isArray(numbers) && numbers.length) {
    for (const raw of numbers) {
      const value = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!value) continue;
      const withLetter = value.match(/^([A-Z])-(\d+)$/);
      const digitsOnly = value.match(/^(\d+)$/);
      if (withLetter) toCreate.push(value);
      else if (digitsOnly) toCreate.push(`${prefix}-${digitsOnly[1]}`);
      else return res.status(400).json({ error: `Invalid flat number "${raw}". Use 101 or A-101.` });
    }
  } else {
    const from = Number(start);
    const to = Number(end);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to < from) {
      return res.status(400).json({ error: 'Provide a valid start/end range (e.g. 101–110) or a numbers list' });
    }
    if (to - from > 500) {
      return res.status(400).json({ error: 'Range too large (max 500 flats at a time)' });
    }
    for (let n = from; n <= to; n++) {
      toCreate.push(`${prefix}-${n}`);
    }
  }

  if (!toCreate.length) return res.status(400).json({ error: 'No flat numbers to create' });

  const mode = ['same', 'infer', 'custom'].includes(floorMode) ? floorMode : 'infer';
  const sameFloor = floor === null || floor === undefined || floor === ''
    ? null
    : Number(floor);
  if (mode === 'same' && sameFloor !== null && (!Number.isInteger(sameFloor) || sameFloor < 0)) {
    return res.status(400).json({ error: 'floor must be a non-negative integer when floorMode is same' });
  }

  const floorsMap = {};
  if (mode === 'custom') {
    if (floors && typeof floors === 'object' && !Array.isArray(floors)) {
      for (const [key, value] of Object.entries(floors)) {
        const n = String(key).trim().toUpperCase().replace(/\s+/g, '');
        const digitsOnly = n.match(/^(\d+)$/);
        const full = digitsOnly ? `${prefix}-${digitsOnly[1]}` : n;
        const parsed = value === null || value === undefined || value === '' ? null : Number(value);
        if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
          return res.status(400).json({ error: `Invalid floor for ${key}` });
        }
        floorsMap[full] = parsed;
      }
    } else if (Array.isArray(floors)) {
      for (let i = 0; i < toCreate.length; i++) {
        const value = floors[i];
        const parsed = value === null || value === undefined || value === '' ? null : Number(value);
        if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
          return res.status(400).json({ error: `Invalid floor at index ${i}` });
        }
        floorsMap[toCreate[i]] = parsed;
      }
    }
  }

  function resolveFloor(number) {
    if (mode === 'same') return sameFloor;
    if (mode === 'custom' && Object.prototype.hasOwnProperty.call(floorsMap, number)) {
      return floorsMap[number];
    }
    return inferFloorFromFlatNumber(number);
  }

  const defaultBhk = normalizeBhkType(bhkType);
  if (bhkType && !defaultBhk) {
    return res.status(400).json({ error: 'bhkType must be 1bhk, 2bhk, or 3bhk' });
  }

  const bhkMap = {};
  if (bhkTypes && typeof bhkTypes === 'object' && !Array.isArray(bhkTypes)) {
    for (const [key, value] of Object.entries(bhkTypes)) {
      const n = String(key).trim().toUpperCase().replace(/\s+/g, '');
      const digitsOnly = n.match(/^(\d+)$/);
      const full = digitsOnly ? `${prefix}-${digitsOnly[1]}` : n;
      const parsed = normalizeBhkType(value);
      if (value && !parsed) return res.status(400).json({ error: `Invalid bhkType for ${key}` });
      bhkMap[full] = parsed;
    }
  } else if (Array.isArray(bhkTypes)) {
    for (let i = 0; i < toCreate.length; i++) {
      const parsed = normalizeBhkType(bhkTypes[i]);
      if (bhkTypes[i] && !parsed) return res.status(400).json({ error: `Invalid bhkType at index ${i}` });
      bhkMap[toCreate[i]] = parsed;
    }
  }

  function resolveBhk(number) {
    if (Object.prototype.hasOwnProperty.call(bhkMap, number)) return bhkMap[number];
    return defaultBhk;
  }

  const existing = await prisma.flat.findMany({
    where: { wingId: wing.id, number: { in: toCreate } },
    select: { number: true }
  });
  const existingSet = new Set(existing.map((f) => f.number));
  const fresh = toCreate.filter((n) => !existingSet.has(n));

  if (!fresh.length) {
    return res.status(400).json({ error: 'All listed flats already exist in this tower' });
  }

  await prisma.flat.createMany({
    data: fresh.map((number) => ({
      number,
      wingId: wing.id,
      floor: resolveFloor(number),
      bhkType: resolveBhk(number)
    }))
  });

  res.json({
    wing: { id: wing.id, name: wing.name, code: wingCodeFromName(wing.name) },
    floorLetter: prefix,
    created: fresh.map((number) => ({
      number,
      floor: resolveFloor(number),
      bhkType: resolveBhk(number)
    })),
    skipped: toCreate.filter((n) => existingSet.has(n))
  });
});

// Update flat details (BHK size, floor)
router.patch('/:buildingId/flats/:flatId', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const flat = await prisma.flat.findFirst({
    where: { id: req.params.flatId, wing: { buildingId: req.params.buildingId } }
  });
  if (!flat) return res.status(404).json({ error: 'Flat not found' });

  const data = {};
  if (req.body.bhkType !== undefined) {
    if (req.body.bhkType === null || req.body.bhkType === '') {
      data.bhkType = null;
    } else {
      const bhk = normalizeBhkType(req.body.bhkType);
      if (!bhk) return res.status(400).json({ error: 'bhkType must be 1bhk, 2bhk, or 3bhk' });
      data.bhkType = bhk;
    }
  }
  if (req.body.floor !== undefined) {
    if (req.body.floor === null || req.body.floor === '') {
      data.floor = null;
    } else {
      const floor = Number(req.body.floor);
      if (!Number.isInteger(floor) || floor < 0) {
        return res.status(400).json({ error: 'floor must be a non-negative integer' });
      }
      data.floor = floor;
    }
  }

  const updated = await prisma.flat.update({
    where: { id: flat.id },
    data,
    include: { wing: { select: { name: true } } }
  });

  res.json({
    id: updated.id,
    number: updated.number,
    floor: updated.floor,
    bhkType: updated.bhkType,
    wing: updated.wing.name,
    wingId: updated.wingId
  });
});

// Delete a vacant flat
router.delete('/:buildingId/flats/:flatId', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const flat = await prisma.flat.findFirst({
    where: { id: req.params.flatId, wing: { buildingId: req.params.buildingId } },
    include: {
      memberships: { where: { status: { in: ['approved', 'pending'] } }, take: 1 },
      bills: { take: 1 },
      visitorLogs: { take: 1 },
      vehicles: { take: 1 }
    }
  });
  if (!flat) return res.status(404).json({ error: 'Flat not found' });
  if (flat.memberships.length) return res.status(400).json({ error: 'Cannot delete an occupied or pending flat' });
  if (flat.bills.length || flat.visitorLogs.length || flat.vehicles.length) {
    return res.status(400).json({ error: 'Cannot delete a flat with bills, visitors, or vehicles' });
  }
  await prisma.flat.delete({ where: { id: flat.id } });
  res.json({ ok: true });
});

// Building Admin: residents and guards awaiting approval
router.get('/:buildingId/approvals', requireRole('building_admin'), async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: {
      buildingId: req.params.buildingId,
      status: 'pending',
      role: { key: { in: ['resident', 'guard'] } }
    },
    include: { user: true, flat: true, role: true },
    orderBy: { user: { createdAt: 'desc' } }
  });
  res.json(memberships);
});

router.patch('/:buildingId/approvals/:membershipId', requireRole('building_admin'), async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });

  const existing = await prisma.membership.findFirst({
    where: { id: req.params.membershipId, buildingId: req.params.buildingId },
    include: {
      role: true,
      flat: { select: { number: true } },
      building: { select: { name: true } },
      user: { select: { id: true, name: true, email: true } }
    }
  });
  if (!existing) return res.status(404).json({ error: 'Membership not found' });

  if (status === 'approved' && existing.role.key === 'guard') {
    const user = await prisma.user.findUnique({ where: { id: existing.userId } });
    if (user && !user.passwordHash) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(GUARD_DEFAULT_PASSWORD) }
      });
    }
  }

  let isFlatMaster = existing.isFlatMaster;
  if (status === 'approved' && existing.role.key === 'resident' && existing.flatId) {
    const hasMaster = await prisma.membership.findFirst({
      where: {
        buildingId: req.params.buildingId,
        flatId: existing.flatId,
        isFlatMaster: true,
        status: 'approved',
        id: { not: existing.id }
      }
    });
    if (!hasMaster) isFlatMaster = true;
  }

  const membership = await prisma.membership.update({
    where: { id: existing.id },
    data: { status, ...(status === 'approved' ? { isFlatMaster } : {}) }
  });

  const approved = status === 'approved';
  const title = approved ? 'Signup approved' : 'Signup not approved';
  const body = approved
    ? `Your ${existing.role.key === 'guard' ? 'guard' : 'resident'} access for ${existing.building.name} is approved.`
    : `Your signup request for ${existing.building.name} was not approved.`;

  await notifyUser(prisma, {
    buildingId: req.params.buildingId,
    userId: existing.userId,
    title,
    body,
    category: 'approval'
  });

  await emailUser(
    prisma,
    existing.userId,
    membershipDecisionEmail({
      approved,
      roleKey: existing.role.key,
      buildingName: existing.building.name,
      flatNumber: existing.flat?.number || null
    })
  );

  res.json(membership);
});

module.exports = router;
