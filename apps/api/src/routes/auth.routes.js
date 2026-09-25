const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { issueOtp, verifyOtp, getOtpStatus, normalizePhone, isDevBypassEnabled } = require('../services/otp');
const { verifyPassword, hashPassword } = require('../utils/password');
const { resolveFlatInBuilding } = require('../utils/flat');
const { authenticate } = require('../middleware/auth');
const { notifyBuildingAdmins } = require('../utils/notifications');
const { emailBuildingAdmins, signupApprovalEmail } = require('../utils/emailNotify');
const router = express.Router();

const GUARD_DEFAULT_PASSWORD = 'Guard@123';

const SURFACE_ROLES = {
  admin: ['building_admin', 'committee_member'],
  mobile: ['resident'],
  guard: ['guard']
};

const SURFACE_EMPTY_ERROR = {
  admin: 'No building admin access for this number.',
  mobile: 'No resident access for this number. Sign in with a resident account, or wait for admin approval.',
  guard: 'This account is not a guard for the selected building.'
};

function mapMembership(m) {
  return {
    id: m.id,
    buildingId: m.buildingId,
    buildingName: m.building.name,
    buildingCode: m.building.buildingCode,
    flatId: m.flatId || null,
    flat: m.flat ? m.flat.number : null,
    floor: m.flat?.floor ?? null,
    role: m.role.key,
    status: m.status,
    isFlatMaster: m.isFlatMaster
  };
}

async function buildLoginResponse(phone, { surface } = {}) {
  const normalized = normalizePhone(phone);
  const user = await prisma.user.findUnique({
    where: { phone: normalized },
    include: {
      memberships: {
        include: {
          role: true,
          building: true,
          flat: true
        }
      }
    }
  });
  if (!user) {
    return { error: 'No account found. Please sign up with a Building Code.', status: 404 };
  }

  const allowedRoles = SURFACE_ROLES[surface];
  let memberships = user.memberships
    .filter((m) => m.status === 'approved')
    .map(mapMembership);

  if (allowedRoles) {
    memberships = memberships.filter((m) => allowedRoles.includes(m.role));
    const superAdminOnAdmin = user.isSuperAdmin && surface === 'admin';
    if (!memberships.length && !superAdminOnAdmin) {
      return { error: SURFACE_EMPTY_ERROR[surface] || 'No access for this login.', status: 403 };
    }
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '30d' });
  return {
    status: 200,
    body: {
      token,
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email, isSuperAdmin: user.isSuperAdmin },
      memberships
    }
  };
}

router.get('/status', (_req, res) => {
  res.json(getOtpStatus());
});

// Public list of registered societies for signup building-code selection.
// Dedupes accidental re-onboards with the same name by keeping the society
// with the most memberships (then newest).
router.get('/buildings', async (_req, res) => {
  const buildings = await prisma.building.findMany({
    select: {
      id: true,
      name: true,
      buildingCode: true,
      city: true,
      createdAt: true,
      _count: { select: { memberships: true } }
    },
    orderBy: [{ name: 'asc' }, { createdAt: 'desc' }]
  });

  const byName = new Map();
  for (const b of buildings) {
    const prev = byName.get(b.name);
    if (!prev || b._count.memberships > prev._count.memberships) {
      byName.set(b.name, b);
    }
  }

  res.json(
    Array.from(byName.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name, buildingCode, city }) => ({ id, name, buildingCode, city }))
  );
});

// Public vacant flats for a building (signup flat picker)
router.get('/buildings/:buildingCode/vacant-flats', async (req, res) => {
  const code = String(req.params.buildingCode || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'buildingCode is required' });

  const building = await prisma.building.findUnique({ where: { buildingCode: code } });
  if (!building) return res.status(404).json({ error: 'Invalid building code' });

  const flats = await prisma.flat.findMany({
    where: {
      wing: { buildingId: building.id },
      memberships: {
        none: { status: { in: ['approved', 'pending'] }, role: { key: 'resident' } }
      }
    },
    include: { wing: { select: { name: true } } },
    orderBy: { number: 'asc' }
  });

  res.json({
    buildingId: building.id,
    buildingName: building.name,
    buildingCode: building.buildingCode,
    flats: flats.map((f) => ({
      id: f.id,
      number: f.number,
      floor: f.floor,
      wing: f.wing.name
    }))
  });
});

router.get('/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      phone: req.user.phone,
      email: req.user.email,
      hasPassword: !!req.user.passwordHash,
      isSuperAdmin: req.user.isSuperAdmin
    }
  });
});

router.patch('/profile', authenticate, async (req, res) => {
  const { name, email, currentPassword, newPassword } = req.body;
  const updates = {};

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ error: 'Name is required' });
    updates.name = trimmed;
  }

  if (email !== undefined) {
    const trimmed = email === null || email === '' ? null : String(email).trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    updates.email = trimmed;
  }

  if (newPassword) {
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (req.user.passwordHash) {
      if (!currentPassword || !verifyPassword(currentPassword, req.user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    updates.passwordHash = hashPassword(String(newPassword));
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No changes to save' });
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: updates
  });

  res.json({
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      hasPassword: !!user.passwordHash,
      isSuperAdmin: user.isSuperAdmin
    }
  });
});

router.post('/request-otp', async (req, res) => {
  const { phone, email, purpose } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });
  if (!getOtpStatus().configured) {
    return res.status(503).json({
      error:
        'OTP delivery is not configured. See apps/api/.env.example (email/Resend, Twilio Verify, or SMS).'
    });
  }

  try {
    const result = await issueOtp(phone, { email, purpose });
    const message =
      result.channel === 'email'
        ? `OTP sent to ${result.emailHint || 'your email'}`
        : result.channel === 'dev-bypass'
          ? result.emailHint
            ? `Dev mode — use demo OTP (email would be ${result.emailHint})`
            : 'Dev mode — use the demo OTP'
          : result.channel === 'sms'
            ? 'OTP sent via SMS'
            : 'OTP sent via WhatsApp';

    res.json({
      message,
      phone: result.phone,
      channel: result.channel,
      emailHint: result.emailHint || null,
      purpose: result.purpose || null
    });
  } catch (e) {
    console.error('[OTP] request failed:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message || 'Failed to send OTP' });
  }
});

router.post('/dev-login', async (req, res) => {
  if (!isDevBypassEnabled()) {
    return res.status(403).json({ error: 'Dev login is disabled' });
  }
  const { phone, surface } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  const result = await buildLoginResponse(phone, { surface });
  if (result.error) return res.status(result.status).json({ error: result.error });
  console.log(`[AUTH] Dev login: ${result.body.user.phone} (${result.body.user.name})`);
  res.json(result.body);
});

router.post('/verify-otp', async (req, res) => {
  const { phone, otp, surface } = req.body;
  const verification = await verifyOtp(phone, otp);
  if (!verification.ok) return res.status(400).json({ error: verification.error });

  const result = await buildLoginResponse(verification.phone, { surface });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result.body);
});

router.post('/login-password', async (req, res) => {
  const { phone, password, surface } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'phone and password are required' });
  }

  const normalized = normalizePhone(phone);
  const user = await prisma.user.findUnique({ where: { phone: normalized } });
  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid phone number or password' });
  }

  const result = await buildLoginResponse(normalized, { surface });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result.body);
});

router.post('/validate-signup', async (req, res) => {
  const { buildingCode, flatNumber } = req.body;
  if (!buildingCode || !flatNumber) {
    return res.status(400).json({ error: 'buildingCode and flatNumber are required' });
  }

  const building = await prisma.building.findUnique({
    where: { buildingCode: buildingCode.trim().toUpperCase() }
  });
  if (!building) return res.status(404).json({ error: 'Invalid building code' });

  const result = await resolveFlatInBuilding(prisma, building.id, flatNumber);
  if (result.error) return res.status(404).json({ error: result.error });

  const occupied = await prisma.membership.findFirst({
    where: {
      flatId: result.flat.id,
      status: { in: ['approved', 'pending'] },
      role: { key: 'resident' }
    }
  });
  if (occupied) {
    return res.status(400).json({ error: `Flat ${result.flat.number} is already claimed` });
  }

  res.json({ ok: true, buildingName: building.name, flatNumber: result.flat.number, floor: result.flat.floor });
});

router.post('/signup', async (req, res) => {
  const { name, phone, email, buildingCode, flatNumber, otp, password } = req.body;
  if (!name || !phone || !buildingCode || !flatNumber || !otp) {
    return res.status(400).json({ error: 'name, phone, buildingCode, flatNumber and otp are required' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password is required (min 6 characters)' });
  }

  const verification = await verifyOtp(phone, otp);
  if (!verification.ok) return res.status(400).json({ error: verification.error });

  const normalizedPhone = verification.phone;
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  const building = await prisma.building.findUnique({ where: { buildingCode: buildingCode.trim().toUpperCase() } });
  if (!building) return res.status(404).json({ error: 'Invalid building code' });

  const flatResult = await resolveFlatInBuilding(prisma, building.id, flatNumber);
  if (flatResult.error) return res.status(404).json({ error: flatResult.error });
  const flat = flatResult.flat;

  const passwordHash = hashPassword(String(password));
  let user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (!user) {
    user = await prisma.user.create({
      data: { name: name.trim(), phone: normalizedPhone, email: normalizedEmail, passwordHash }
    });
  } else {
    const updates = { passwordHash };
    if (name.trim()) updates.name = name.trim();
    if (normalizedEmail) updates.email = normalizedEmail;
    user = await prisma.user.update({ where: { id: user.id }, data: updates });
  }

  const residentRole = await prisma.role.findUnique({ where: { key: 'resident' } });
  const existingSameFlat = await prisma.membership.findFirst({
    where: { userId: user.id, buildingId: building.id, roleId: residentRole.id, flatId: flat.id }
  });
  if (existingSameFlat) {
    return res.json({ message: `Request already ${existingSameFlat.status}.`, membershipId: existingSameFlat.id });
  }

  const otherOccupant = await prisma.membership.findFirst({
    where: {
      flatId: flat.id,
      roleId: residentRole.id,
      status: { in: ['approved', 'pending'] },
      NOT: { userId: user.id }
    }
  });
  if (otherOccupant) {
    return res.status(400).json({ error: `Flat ${flat.number} is already claimed by another resident` });
  }

  const membership = await prisma.membership.create({
    data: { userId: user.id, buildingId: building.id, flatId: flat.id, roleId: residentRole.id, status: 'pending' }
  });

  const otherFlats = await prisma.membership.count({
    where: {
      userId: user.id,
      buildingId: building.id,
      roleId: residentRole.id,
      flatId: { not: flat.id },
      status: { in: ['approved', 'pending'] }
    }
  });

  await notifyBuildingAdmins(prisma, building.id, {
    title: 'New resident signup',
    body: `${user.name} · Flat ${flat.number} awaiting approval`,
    category: 'approval'
  });

  // Email is additive — never blocks signup if Resend/admins missing
  await emailBuildingAdmins(
    prisma,
    building.id,
    signupApprovalEmail({
      kind: 'resident',
      applicantName: user.name,
      phone: user.phone,
      buildingName: building.name,
      buildingId: building.id,
      flatNumber: flat.number
    })
  );

  res.json({
    message: otherFlats
      ? `Additional flat request submitted for ${flat.number}. Waiting for admin approval.`
      : 'Signup request submitted. Waiting for admin approval.',
    membershipId: membership.id
  });
});

router.post('/validate-guard-signup', async (req, res) => {
  const { buildingCode } = req.body;
  if (!buildingCode) return res.status(400).json({ error: 'buildingCode is required' });

  const building = await prisma.building.findUnique({
    where: { buildingCode: buildingCode.trim().toUpperCase() }
  });
  if (!building) return res.status(404).json({ error: 'Invalid building code' });

  res.json({ ok: true, buildingName: building.name, buildingCode: building.buildingCode });
});

router.post('/guard-signup', async (req, res) => {
  const { name, phone, email, buildingCode, otp } = req.body;
  if (!name || !phone || !buildingCode || !otp) {
    return res.status(400).json({ error: 'name, phone, buildingCode and otp are required' });
  }

  const verification = await verifyOtp(phone, otp);
  if (!verification.ok) return res.status(400).json({ error: verification.error });

  const normalizedPhone = verification.phone;
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }

  const building = await prisma.building.findUnique({ where: { buildingCode: buildingCode.trim().toUpperCase() } });
  if (!building) return res.status(404).json({ error: 'Invalid building code' });

  let user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: name.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        passwordHash: hashPassword(GUARD_DEFAULT_PASSWORD)
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name.trim(),
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
        passwordHash: user.passwordHash || hashPassword(GUARD_DEFAULT_PASSWORD)
      }
    });
  }

  const guardRole = await prisma.role.findUnique({ where: { key: 'guard' } });
  const existing = await prisma.membership.findFirst({
    where: { userId: user.id, buildingId: building.id, roleId: guardRole.id }
  });
  if (existing) {
    return res.json({ message: `Request already ${existing.status}.`, membershipId: existing.id });
  }

  const membership = await prisma.membership.create({
    data: { userId: user.id, buildingId: building.id, roleId: guardRole.id, status: 'pending' }
  });

  await notifyBuildingAdmins(prisma, building.id, {
    title: 'New guard signup',
    body: `${user.name} awaiting approval as security guard`,
    category: 'approval'
  });

  await emailBuildingAdmins(
    prisma,
    building.id,
    signupApprovalEmail({
      kind: 'guard',
      applicantName: user.name,
      phone: user.phone,
      buildingName: building.name,
      buildingId: building.id
    })
  );

  res.json({ message: 'Guard signup request submitted. Waiting for admin approval.', membershipId: membership.id });
});

module.exports = router;
