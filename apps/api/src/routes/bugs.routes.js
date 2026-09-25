const express = require('express');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { requireRole, requireSuperAdmin } = require('../middleware/rbac');
const { optionalBugImage } = require('../middleware/upload');
const {
  adminWebBaseUrl,
  buildActionEmail,
  sendToEmails,
  bugReportEmail
} = require('../utils/emailNotify');

const router = express.Router();

const ALLOWED_CATEGORIES = new Set([
  'Login',
  'Home',
  'Bills',
  'Visitors',
  'Complaints',
  'Finance',
  'Residents',
  'Facilities',
  'Other'
]);

const ALLOWED_STATUSES = new Set(['open', 'in_review', 'resolved']);
const RATE_LIMIT_HOURS = 1;
const RATE_LIMIT_MAX = 5;
const MIN_MESSAGE_LEN = 10;

function makeReference() {
  return `BUG-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function supportEmails() {
  const fromEnv = String(process.env.SUPPORT_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv;
}

async function resolveSupportRecipients() {
  const configured = supportEmails();
  if (configured.length) return configured;

  const supers = await prisma.user.findMany({
    where: { isSuperAdmin: true, email: { not: null } },
    select: { email: true }
  });
  return supers.map((u) => u.email).filter(Boolean);
}

router.post(
  '/',
  requireRole('resident', 'guard', 'building_admin', 'committee_member'),
  optionalBugImage,
  async (req, res) => {
    // optionalBugImage (multer) has already written req.file to disk before
    // this handler runs — every early return below, and a failed create()
    // itself, must clean it up or it's orphaned on disk. Once create()
    // succeeds the file is legitimately referenced by imageUrl and must be
    // left alone even if a later step (e.g. sending email) fails.
    const cleanupUploadedFile = () => {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    };

    const message = String(req.body.message || '').trim();
    const categoryRaw = String(req.body.category || 'Other').trim();
    const category = ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : 'Other';
    const sourceRaw = String(req.body.source || 'mobile').trim().toLowerCase();
    const source = sourceRaw === 'admin-web' ? 'admin-web' : 'mobile';

    if (message.length < MIN_MESSAGE_LEN) {
      cleanupUploadedFile();
      return res.status(400).json({
        error: `Please describe the issue in at least ${MIN_MESSAGE_LEN} characters.`
      });
    }

    const roleKey = req.membership?.role?.key;
    if (!roleKey) {
      cleanupUploadedFile();
      return res.status(403).json({ error: 'Approved membership required' });
    }

    const since = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000);
    const recentCount = await prisma.bugReport.count({
      where: { userId: req.user.id, createdAt: { gte: since } }
    });
    if (recentCount >= RATE_LIMIT_MAX) {
      cleanupUploadedFile();
      return res.status(429).json({
        error: 'Too many bug reports. Please try again later.'
      });
    }

    let flatNumber = null;
    if (req.membership?.flatId) {
      const flat = await prisma.flat.findUnique({
        where: { id: req.membership.flatId },
        select: { number: true }
      });
      flatNumber = flat?.number || null;
    }

    const building = await prisma.building.findUnique({
      where: { id: req.buildingId },
      select: { id: true, name: true }
    });
    if (!building) {
      cleanupUploadedFile();
      return res.status(404).json({ error: 'Building not found' });
    }

    const imageUrl = req.file ? `/uploads/bugs/${req.file.filename}` : null;

    const reference = makeReference();
    let report;
    try {
      report = await prisma.bugReport.create({
        data: {
          buildingId: req.buildingId,
          userId: req.user.id,
          roleKey,
          source,
          category,
          message,
          status: 'open',
          reference,
          flatNumber,
          imageUrl
        }
      });
    } catch (e) {
      cleanupUploadedFile();
      throw e; // still forwarded to the global error handler via wrapRouterAsync
    }

    const recipients = await resolveSupportRecipients();
    const ctaUrl = `${adminWebBaseUrl()}/bugs`;
    await sendToEmails(
      recipients,
      bugReportEmail({
        reference,
        reporterName: req.user.name,
        reporterPhone: req.user.phone,
        roleKey,
        source,
        category,
        message,
        buildingName: building.name,
        flatNumber,
        hasScreenshot: !!imageUrl,
        ctaUrl
      })
    );

    res.status(201).json({
      id: report.id,
      reference: report.reference,
      status: report.status,
      createdAt: report.createdAt
    });
  }
);

router.get('/', requireSuperAdmin, async (req, res) => {
  const where = {};
  if (req.query.status && ALLOWED_STATUSES.has(String(req.query.status))) {
    where.status = String(req.query.status);
  }
  if (req.query.buildingId) where.buildingId = String(req.query.buildingId);
  if (req.query.roleKey) where.roleKey = String(req.query.roleKey);

  const reports = await prisma.bugReport.findMany({
    where,
    include: {
      building: { select: { id: true, name: true, buildingCode: true } },
      user: { select: { id: true, name: true, phone: true, email: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  res.json(reports);
});

router.patch('/:id', requireSuperAdmin, async (req, res) => {
  const status = String(req.body.status || '').trim();
  if (!ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status. Use open, in_review, or resolved.' });
  }

  const existing = await prisma.bugReport.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Bug report not found' });

  const updated = await prisma.bugReport.update({
    where: { id: existing.id },
    data: { status },
    include: {
      building: { select: { id: true, name: true, buildingCode: true } },
      user: { select: { id: true, name: true, phone: true, email: true } }
    }
  });

  res.json(updated);
});

module.exports = router;
