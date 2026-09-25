const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { normalizePhone } = require('../services/otp');
const { hashPassword } = require('../utils/password');
const { notifyUser, notifyFlatResidents, notifyBuildingAdmins } = require('../utils/notifications');
const { emailBuildingAdmins, familyAdminEmail } = require('../utils/emailNotify');
const { flatFamilyMemberFilter } = require('../utils/flatScope');
const { ensureFlatMaster, assertFlatMaster } = require('../utils/flatMaster');
const router = express.Router();

const STATUS_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  revoked: 'Access revoked'
};

function mapFamilyMember(m) {
  return {
    id: m.id,
    membershipId: m.membershipId,
    userId: m.userId,
    name: m.name,
    relation: m.relation,
    phone: m.phone,
    status: m.status,
    statusLabel: STATUS_LABELS[m.status] || m.status,
    createdAt: m.createdAt,
    flatNumber: m.membership?.flat?.number || null,
    primaryResidentName: m.membership?.user?.name || null,
    primaryResidentPhone: m.membership?.user?.phone || null
  };
}

router.get('/overview', requireRole('resident'), async (req, res) => {
  if (!req.membership.flatId) {
    return res.status(400).json({ error: 'Flat assignment required' });
  }

  const master = await ensureFlatMaster(prisma, req.buildingId, req.membership.flatId);
  const flat = await prisma.flat.findUnique({
    where: { id: req.membership.flatId },
    select: { number: true }
  });

  const members = await prisma.familyMember.findMany({
    where: await flatFamilyMemberFilter(prisma, req),
    include: {
      membership: {
        include: { flat: { select: { number: true } }, user: { select: { name: true, phone: true } } }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json({
    flatNumber: flat?.number || null,
    isMaster: !!req.membership.isFlatMaster,
    master: master ? {
      userId: master.user.id,
      name: master.user.name,
      phone: master.user.phone
    } : null,
    members: members.map(mapFamilyMember)
  });
});

router.get('/', requireRole('resident'), async (req, res) => {
  const members = await prisma.familyMember.findMany({
    where: await flatFamilyMemberFilter(prisma, req),
    include: {
      membership: {
        include: { flat: { select: { number: true } }, user: { select: { name: true } } }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(members.map(mapFamilyMember));
});

router.get('/approvals', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const members = await prisma.familyMember.findMany({
    where: {
      status: 'pending',
      membership: { buildingId: req.buildingId }
    },
    include: {
      membership: {
        include: {
          flat: { select: { number: true } },
          user: { select: { name: true, phone: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(members.map(mapFamilyMember));
});

router.get('/approvals/count', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const count = await prisma.familyMember.count({
    where: { status: 'pending', membership: { buildingId: req.buildingId } }
  });
  res.json({ count });
});

router.post('/', requireRole('resident'), async (req, res) => {
  if (!assertFlatMaster(req, res)) return;

  const { name, relation, phone, password } = req.body;
  if (!name?.trim() || !relation?.trim() || !phone?.trim() || !password) {
    return res.status(400).json({ error: 'name, relation, phone and password are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone === req.user.phone) {
    return res.status(400).json({ error: 'Use your own login for the master account' });
  }

  const existingUser = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (existingUser) {
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: existingUser.id, buildingId: req.buildingId, status: 'approved' }
    });
    if (existingMembership) {
      return res.status(409).json({ error: 'This phone number already has access to the society app' });
    }
  }

  const duplicateActive = await prisma.familyMember.findFirst({
    where: {
      phone: normalizedPhone,
      status: { in: ['pending', 'approved'] },
      membership: { buildingId: req.buildingId }
    }
  });
  if (duplicateActive) {
    return res.status(409).json({
      error: duplicateActive.status === 'pending'
        ? 'An approval request for this phone is already pending'
        : 'This phone is already registered as a family member in this society'
    });
  }

  const residentRole = await prisma.role.findUnique({ where: { key: 'resident' } });
  const passwordHash = hashPassword(String(password));

  let user = existingUser;
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: name.trim(),
        phone: normalizedPhone,
        passwordHash
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { name: name.trim(), passwordHash }
    });
  }

  const flatId = req.membership.flatId;
  const membershipExists = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      buildingId: req.buildingId,
      roleId: residentRole.id,
      flatId
    }
  });

  if (!membershipExists) {
    await prisma.membership.create({
      data: {
        userId: user.id,
        buildingId: req.buildingId,
        flatId,
        roleId: residentRole.id,
        status: 'approved',
        isFlatMaster: false
      }
    });
  } else if (membershipExists.status !== 'approved') {
    await prisma.membership.update({
      where: { id: membershipExists.id },
      data: { status: 'approved', flatId, isFlatMaster: false }
    });
  }

  const member = await prisma.familyMember.create({
    data: {
      membershipId: req.membership.id,
      userId: user.id,
      name: name.trim(),
      relation: relation.trim(),
      phone: normalizedPhone,
      passwordHash,
      status: 'approved'
    },
    include: {
      membership: {
        include: { flat: { select: { number: true } }, user: { select: { name: true } } }
      }
    }
  });

  const flatLabel = member.membership?.flat?.number
    ? `Flat ${member.membership.flat.number}`
    : 'A flat';

  await notifyUser(prisma, {
    buildingId: req.buildingId,
    userId: user.id,
    title: 'Family access ready',
    body: `You can sign in with your phone and password for ${flatLabel}.`,
    category: 'family'
  });

  await notifyBuildingAdmins(prisma, req.buildingId, {
    title: 'Family member added',
    body: `${flatLabel} · ${member.name} (${member.relation}) added by master user`,
    category: 'family'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailBuildingAdmins(
    prisma,
    req.buildingId,
    familyAdminEmail({
      flatLabel,
      memberName: member.name,
      relation: member.relation,
      buildingName: building?.name || 'Your society'
    })
  );

  res.json(mapFamilyMember(member));
});

router.patch('/:id/password', requireRole('resident'), async (req, res) => {
  if (!assertFlatMaster(req, res)) return;

  const { password } = req.body;
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await prisma.familyMember.findFirst({
    where: {
      id: req.params.id,
      status: 'approved',
      ...(await flatFamilyMemberFilter(prisma, req))
    }
  });
  if (!existing) return res.status(404).json({ error: 'Approved family member not found' });

  const passwordHash = hashPassword(String(password));
  await prisma.familyMember.update({
    where: { id: existing.id },
    data: { passwordHash }
  });

  if (existing.userId) {
    await prisma.user.update({
      where: { id: existing.userId },
      data: { passwordHash }
    });
    await notifyUser(prisma, {
      buildingId: req.buildingId,
      userId: existing.userId,
      title: 'Password updated',
      body: 'Your society app password was changed by the flat master user.',
      category: 'family'
    });
  }

  res.json({ ok: true });
});

router.patch('/:id/revoke', requireRole('resident'), async (req, res) => {
  if (!assertFlatMaster(req, res)) return;

  const existing = await prisma.familyMember.findFirst({
    where: {
      id: req.params.id,
      status: 'approved',
      ...(await flatFamilyMemberFilter(prisma, req))
    }
  });
  if (!existing) return res.status(404).json({ error: 'Approved family member not found' });
  if (existing.userId === req.user.id) {
    return res.status(400).json({ error: 'Master user cannot revoke their own access' });
  }

  const residentRole = await prisma.role.findUnique({ where: { key: 'resident' } });
  if (existing.userId) {
    await prisma.membership.updateMany({
      where: {
        userId: existing.userId,
        buildingId: req.buildingId,
        roleId: residentRole.id,
        isFlatMaster: false
      },
      data: { status: 'rejected' }
    });
    await notifyUser(prisma, {
      buildingId: req.buildingId,
      userId: existing.userId,
      title: 'Society app access revoked',
      body: 'Your access to this society was revoked by the flat master user.',
      category: 'family'
    });
  }

  const updated = await prisma.familyMember.update({
    where: { id: existing.id },
    data: { status: 'revoked' },
    include: {
      membership: {
        include: { flat: { select: { number: true } }, user: { select: { name: true } } }
      }
    }
  });

  res.json(mapFamilyMember(updated));
});

router.patch('/:id/review', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }

  const existing = await prisma.familyMember.findFirst({
    where: {
      id: req.params.id,
      status: 'pending',
      membership: { buildingId: req.buildingId }
    },
    include: {
      membership: { include: { flat: true, user: true, role: true } }
    }
  });
  if (!existing) return res.status(404).json({ error: 'Family member request not found' });

  if (status === 'rejected') {
    const updated = await prisma.familyMember.update({
      where: { id: existing.id },
      data: { status: 'rejected' },
      include: {
        membership: {
          include: { flat: { select: { number: true } }, user: { select: { name: true } } }
        }
      }
    });
    await notifyUser(prisma, {
      buildingId: req.buildingId,
      userId: existing.membership.userId,
      title: 'Family member request rejected',
      body: `${existing.name} (${existing.relation}) was not approved by the admin.`,
      category: 'family'
    });
    return res.json(mapFamilyMember(updated));
  }

  const residentRole = await prisma.role.findUnique({ where: { key: 'resident' } });
  let user = await prisma.user.findUnique({ where: { phone: existing.phone } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: existing.name,
        phone: existing.phone,
        passwordHash: existing.passwordHash
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { name: existing.name, passwordHash: existing.passwordHash }
    });
  }

  const membershipExists = await prisma.membership.findFirst({
    where: { userId: user.id, buildingId: req.buildingId, roleId: residentRole.id }
  });

  if (!membershipExists) {
    await prisma.membership.create({
      data: {
        userId: user.id,
        buildingId: req.buildingId,
        flatId: existing.membership.flatId,
        roleId: residentRole.id,
        status: 'approved',
        isFlatMaster: false
      }
    });
  } else if (membershipExists.status !== 'approved') {
    await prisma.membership.update({
      where: { id: membershipExists.id },
      data: { status: 'approved', flatId: existing.membership.flatId, isFlatMaster: false }
    });
  }

  const updated = await prisma.familyMember.update({
    where: { id: existing.id },
    data: { status: 'approved', userId: user.id },
    include: {
      membership: {
        include: { flat: { select: { number: true } }, user: { select: { name: true } } }
      }
    }
  });

  await notifyUser(prisma, {
    buildingId: req.buildingId,
    userId: user.id,
    title: 'Family member access approved',
    body: `You can now sign in with your phone number and password for flat ${existing.membership.flat?.number || ''}.`,
    category: 'family'
  });

  await notifyFlatResidents(prisma, req.buildingId, existing.membership.flatId, {
    title: 'Family member approved',
    body: `${existing.name} can now log in to the society app.`,
    category: 'family'
  });

  res.json(mapFamilyMember(updated));
});

router.delete('/:id', requireRole('resident'), async (req, res) => {
  if (!assertFlatMaster(req, res)) return;

  const existing = await prisma.familyMember.findFirst({
    where: {
      id: req.params.id,
      ...(await flatFamilyMemberFilter(prisma, req))
    }
  });
  if (!existing) return res.status(404).json({ error: 'Family member not found' });
  if (existing.status === 'approved') {
    return res.status(400).json({ error: 'Use revoke access for approved members' });
  }
  await prisma.familyMember.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
