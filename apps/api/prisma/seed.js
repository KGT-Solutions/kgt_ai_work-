require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/utils/password');
const prisma = new PrismaClient();

const SUPER_ADMIN_PHONE = '+919837722599';
const SUPER_ADMIN_PASSWORD = 'Sanyam@123';
const GUARD_DEFAULT_PASSWORD = 'Guard@123';

const ROLES = [
  { key: 'super_admin', name: 'Super Admin' },
  { key: 'building_admin', name: 'Building Admin' },
  { key: 'committee_member', name: 'Committee Member' },
  { key: 'guard', name: 'Guard' },
  { key: 'resident', name: 'Resident' }
];

const FEATURES = [
  { key: 'maintenance_bills', name: 'Maintenance Bills', category: 'billing' },
  { key: 'dues_reminders', name: 'Dues & Reminders', category: 'billing' },
  { key: 'online_payments', name: 'Online Payments', category: 'billing' },
  { key: 'expense_tracking', name: 'Expense Tracking', category: 'billing' },
  { key: 'visitor_management', name: 'Visitor Management', category: 'security' },
  { key: 'gate_pass', name: 'Gate Pass', category: 'security' },
  { key: 'security_alerts', name: 'Security Alerts', category: 'security' },
  { key: 'cctv_integrations', name: 'CCTV Integrations', category: 'security' },
  { key: 'announcements', name: 'Announcements', category: 'community' },
  { key: 'complaints', name: 'Complaints', category: 'community' },
  { key: 'facilities_booking', name: 'Facilities Booking', category: 'community' },
  { key: 'community_directory', name: 'Community Directory', category: 'community' },
  { key: 'polls_votes', name: 'Polls & Votes', category: 'addon' },
  { key: 'documents', name: 'Documents', category: 'addon' },
  { key: 'parking_management', name: 'Parking Management', category: 'addon' },
  { key: 'ev_charging', name: 'EV Charging', category: 'addon' },
  { key: 'marketplace', name: 'Marketplace', category: 'addon' }
];

async function main() {
  for (const role of ROLES) {
    await prisma.role.upsert({ where: { key: role.key }, update: {}, create: role });
  }
  for (const feature of FEATURES) {
    await prisma.feature.upsert({ where: { key: feature.key }, update: {}, create: feature });
  }

  await prisma.user.upsert({
    where: { phone: SUPER_ADMIN_PHONE },
    update: {
      isSuperAdmin: true,
      name: 'Sanyam',
      passwordHash: hashPassword(SUPER_ADMIN_PASSWORD)
    },
    create: {
      name: 'Sanyam',
      phone: SUPER_ADMIN_PHONE,
      isSuperAdmin: true,
      passwordHash: hashPassword(SUPER_ADMIN_PASSWORD)
    }
  });

  const building = await prisma.building.upsert({
    where: { buildingCode: 'GRM4821' },
    update: {},
    create: {
      name: 'Green Meadows Society',
      address: 'Plot 14, Sector 21',
      city: 'Pune',
      buildingCode: 'GRM4821',
      subscriptionTier: 'standard'
    }
  });

  const allFeatures = await prisma.feature.findMany();
  for (const feature of allFeatures) {
    await prisma.buildingFeature.upsert({
      where: { buildingId_featureId: { buildingId: building.id, featureId: feature.id } },
      update: {},
      create: { buildingId: building.id, featureId: feature.id, isEnabled: true }
    });
  }

  const towerNames = ['01', '02', '03'];
  const wings = {};
  for (const n of towerNames) {
    const name = `Tower-${n}`;
    const existing = await prisma.wing.findFirst({ where: { name, buildingId: building.id } });
    wings[n] = existing || (await prisma.wing.create({ data: { name, buildingId: building.id } }));
  }

  const { inferFloorFromFlatNumber } = require('../src/utils/flat');

  async function ensureFlat(number, towerKey = '1') {
    const existing = await prisma.flat.findFirst({ where: { number, wingId: wings[towerKey].id } });
    return existing || (await prisma.flat.create({
      data: {
        number,
        wingId: wings[towerKey].id,
        floor: inferFloorFromFlatNumber(number)
      }
    }));
  }

  /** Upsert membership using current unique (userId, buildingId, roleId, flatId). */
  async function ensureMembership({ userId, buildingId, roleId, flatId = null, status = 'approved', isFlatMaster = false }) {
    const existing = await prisma.membership.findFirst({
      where: { userId, buildingId, roleId, flatId }
    });
    if (existing) {
      return prisma.membership.update({
        where: { id: existing.id },
        data: { status, isFlatMaster, ...(flatId != null ? { flatId } : {}) }
      });
    }
    return prisma.membership.create({
      data: { userId, buildingId, roleId, flatId, status, isFlatMaster }
    });
  }

  const flatB402 = await ensureFlat('B-402', '01');
  await ensureFlat('A-1203', '01');
  await ensureFlat('C-302', '01');
  await ensureFlat('D-101', '01');

  const roleMap = {};
  for (const r of await prisma.role.findMany()) roleMap[r.key] = r.id;

  const asha = await prisma.user.upsert({
    where: { phone: '+919876500001' },
    update: { email: 'delivered@resend.dev' },
    create: { name: 'Asha Rao', phone: '+919876500001', email: 'delivered@resend.dev' }
  });
  await ensureMembership({
    userId: asha.id,
    buildingId: building.id,
    roleId: roleMap.resident,
    flatId: flatB402.id,
    status: 'approved',
    isFlatMaster: true
  });

  const admin = await prisma.user.upsert({
    where: { phone: '+919876500002' },
    update: { email: 'admin.s@example.com' },
    create: { name: 'Admin S.', phone: '+919876500002', email: 'admin.s@example.com' }
  });
  await ensureMembership({
    userId: admin.id,
    buildingId: building.id,
    roleId: roleMap.building_admin,
    status: 'approved'
  });

  const guard = await prisma.user.upsert({
    where: { phone: '+919876500003' },
    update: {
      passwordHash: hashPassword(GUARD_DEFAULT_PASSWORD),
      email: 'guard@example.com'
    },
    create: {
      name: 'Security Guard',
      phone: '+919876500003',
      email: 'guard@example.com',
      passwordHash: hashPassword(GUARD_DEFAULT_PASSWORD)
    }
  });
  await ensureMembership({
    userId: guard.id,
    buildingId: building.id,
    roleId: roleMap.guard,
    status: 'approved'
  });

  const existingBills = await prisma.bill.count({ where: { buildingId: building.id } });
  if (existingBills === 0) {
    await prisma.bill.create({
      data: {
        buildingId: building.id, flatId: flatB402.id, month: 'May 2025', amount: 2450,
        dueDate: new Date('2025-05-05'), status: 'due',
        breakdown: JSON.stringify([
          { label: 'Maintenance charges', amount: 2000 },
          { label: 'Sinking fund', amount: 350 },
          { label: 'Late fee', amount: 100 }
        ])
      }
    });
    await prisma.bill.create({ data: { buildingId: building.id, flatId: flatB402.id, month: 'April 2025', amount: 2450, dueDate: new Date('2025-04-01'), status: 'paid' } });
    await prisma.bill.create({ data: { buildingId: building.id, flatId: flatB402.id, month: 'March 2025', amount: 2450, dueDate: new Date('2025-03-01'), status: 'paid' } });

    await prisma.complaint.createMany({
      data: [
        { buildingId: building.id, userId: asha.id, category: 'Plumbing', title: 'Kitchen sink leakage', description: 'Water leakage from under the kitchen sink.', status: 'in_progress' },
        { buildingId: building.id, userId: asha.id, category: 'Electrical', title: 'Corridor light not working', description: 'Light near lift lobby is not working since yesterday.', status: 'in_progress' },
        { buildingId: building.id, userId: asha.id, category: 'Other', title: 'Lift making noise', description: 'Strange noise while the lift is moving between floors.', status: 'resolved' },
        { buildingId: building.id, userId: asha.id, category: 'Housekeeping', title: 'Garbage not cleared', description: 'Garbage not cleared from the dump area.', status: 'resolved' },
        { buildingId: building.id, userId: asha.id, category: 'Parking', title: 'Visitor parking issue', description: 'Visitors are parking in my allocated spot.', status: 'submitted' }
      ]
    });

    await prisma.visitorLog.createMany({
      data: [
        { buildingId: building.id, flatId: flatB402.id, visitorName: 'Ravi Kumar', purpose: 'Guest', status: 'inside' },
        { buildingId: building.id, visitorName: 'Zomato Delivery', purpose: 'Delivery', status: 'inside' },
        { buildingId: building.id, visitorName: 'Arjun Mehta', purpose: 'Guest', status: 'exited' },
        { buildingId: building.id, visitorName: 'Electrician', purpose: 'Service', status: 'inside' }
      ]
    });

    const clubhouse = await prisma.facility.create({ data: { buildingId: building.id, name: 'Clubhouse', icon: 'clubhouse', capacity: 50, pricePerHour: 500, description: 'Multi-purpose hall for events and gatherings.' } });
    await prisma.facility.create({ data: { buildingId: building.id, name: 'Tennis Court', icon: 'tennis', capacity: 4, pricePerHour: 300 } });
    await prisma.facility.create({ data: { buildingId: building.id, name: 'Party Hall', icon: 'party', capacity: 100, pricePerHour: 1500 } });
    await prisma.facility.create({ data: { buildingId: building.id, name: 'Gym', icon: 'gym', capacity: 20, pricePerHour: 0 } });

    const vote = await prisma.vote.create({
      data: { buildingId: building.id, question: 'Should we install EV charging points?', closesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }
    });
    const yesOption = await prisma.voteOption.create({ data: { voteId: vote.id, label: 'Yes' } });
    await prisma.voteOption.create({ data: { voteId: vote.id, label: 'No' } });
    await prisma.voteResponse.create({ data: { voteOptionId: yesOption.id, userId: asha.id } });

    await prisma.announcement.createMany({
      data: [
        { buildingId: building.id, title: 'Water tank cleaning on May 10', body: 'Please ensure water usage is limited.', category: 'maintenance', pinned: true },
        { buildingId: building.id, title: 'Society Annual General Meeting', body: 'AGM on May 18, 2025 at 6:00 PM in the clubhouse.', category: 'event' }
      ]
    });

    await prisma.emergencyContact.createMany({
      data: [
        { buildingId: building.id, name: 'Ambulance', phone: '108', category: 'ambulance' },
        { buildingId: building.id, name: 'Police', phone: '100', category: 'police' },
        { buildingId: building.id, name: 'Fire', phone: '101', category: 'fire' },
        { buildingId: building.id, name: 'Building Security', phone: '+91 98765 43210', category: 'security' },
        { buildingId: building.id, name: 'Electrician on-call', phone: '+91 98765 43211', category: 'electrician' },
        { buildingId: building.id, name: 'Plumber on-call', phone: '+91 98765 43212', category: 'plumber' }
      ]
    });
  }

  console.log('Seed complete.');
  console.log('Building code:', building.buildingCode);
  console.log('Super admin login: use admin panel → Super admin with password');

  // Ensure the primary Gd Apartments demo society exists with a stable code
  const gd = await prisma.building.upsert({
    where: { buildingCode: 'GDA9762' },
    update: {
      name: 'Gd Apartments',
      address: 'Street 8, Sector 104, Noida, Uttar Pradesh, 201304',
      city: 'Noida',
      subscriptionTier: 'premium'
    },
    create: {
      name: 'Gd Apartments',
      address: 'Street 8, Sector 104, Noida, Uttar Pradesh, 201304',
      city: 'Noida',
      buildingCode: 'GDA9762',
      subscriptionTier: 'premium'
    }
  });
  for (const feature of allFeatures) {
    await prisma.buildingFeature.upsert({
      where: { buildingId_featureId: { buildingId: gd.id, featureId: feature.id } },
      update: {},
      create: { buildingId: gd.id, featureId: feature.id, isEnabled: true }
    });
  }
  const gdAdmin = await prisma.user.upsert({
    where: { phone: '+917417466060' },
    update: { name: 'Sanyam', email: 'sanyam.gd@example.com' },
    create: { name: 'Sanyam', phone: '+917417466060', email: 'sanyam.gd@example.com' }
  });
  await ensureMembership({
    userId: gdAdmin.id,
    buildingId: gd.id,
    roleId: roleMap.building_admin,
    status: 'approved'
  });

  console.log('Gd Apartments building code: GDA9762');

  // Second demo society with its own building admin (separate from Gd Apartments)
  const gd2 = await prisma.building.upsert({
    where: { buildingCode: 'GDA5513' },
    update: {
      name: 'Gd Apartments2',
      address: 'Sector 137, Noida, Uttar Pradesh',
      city: 'Noida',
      subscriptionTier: 'premium'
    },
    create: {
      name: 'Gd Apartments2',
      address: 'Sector 137, Noida, Uttar Pradesh',
      city: 'Noida',
      buildingCode: 'GDA5513',
      subscriptionTier: 'premium'
    }
  });
  for (const feature of allFeatures) {
    await prisma.buildingFeature.upsert({
      where: { buildingId_featureId: { buildingId: gd2.id, featureId: feature.id } },
      update: {},
      create: { buildingId: gd2.id, featureId: feature.id, isEnabled: true }
    });
  }
  const gd2Admin = await prisma.user.upsert({
    where: { phone: '+917417466061' },
    update: { name: 'Sanyam (Gd2)', email: 'sanyam.gd2@example.com' },
    create: { name: 'Sanyam (Gd2)', phone: '+917417466061', email: 'sanyam.gd2@example.com' }
  });
  await ensureMembership({
    userId: gd2Admin.id,
    buildingId: gd2.id,
    roleId: roleMap.building_admin,
    status: 'approved'
  });
  // Same phone can admin more than one society — post-login picker lists each card
  await ensureMembership({
    userId: gdAdmin.id,
    buildingId: gd2.id,
    roleId: roleMap.building_admin,
    status: 'approved'
  });
  console.log('Gd Apartments2 building code: GDA5513');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
