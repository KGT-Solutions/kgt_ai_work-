const express = require('express');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { optionalFinanceImage } = require('../middleware/upload');
const { resolveFlatInBuilding } = require('../utils/flat');
const { notifyFlatResidents, notifyBuildingAdmins } = require('../utils/notifications');
const { emailFlatResidents, emailBuildingAdmins, ledgerEmail, paymentAdminEmail } = require('../utils/emailNotify');
const {
  createChargeAndApplyAdvance,
  recordFlatPayment,
  createPendingPayment,
  getFlatAccount,
  remainingOnBill
} = require('../utils/finance');
const router = express.Router();

function mapBill(b) {
  const payments = b.payments || [];
  const approved = payments.filter((p) => !p.status || p.status === 'approved');
  const pending = payments.find((p) => p.status === 'pending_review') || null;
  const receiptPayment = approved.find((p) => p.receiptUrl) || approved[0] || null;
  return {
    ...b,
    remaining: remainingOnBill(b),
    amountPaid: Number(b.amountPaid || 0),
    receiptUrl: receiptPayment?.receiptUrl || null,
    paidMethod: receiptPayment?.method || null,
    paidAt: receiptPayment?.paidAt || null,
    pendingPayment: pending
      ? {
          id: pending.id,
          amount: pending.amount,
          receiptUrl: pending.receiptUrl,
          paidAt: pending.paidAt,
          status: pending.status
        }
      : null
  };
}

router.get('/', requireRole('resident', 'building_admin', 'committee_member'), async (req, res) => {
  const where = { buildingId: req.buildingId };
  if (req.membership?.role?.key === 'resident') where.flatId = req.membership.flatId;

  const bills = await prisma.bill.findMany({
    where,
    include: {
      flat: true,
      payments: {
        where: { status: { in: ['approved', 'pending_review'] } },
        select: {
          id: true,
          receiptUrl: true,
          method: true,
          paidAt: true,
          amount: true,
          gateway: true,
          status: true
        },
        orderBy: { paidAt: 'desc' }
      }
    },
    orderBy: { dueDate: 'desc' }
  });

  let account = null;
  if (req.membership?.role?.key === 'resident' && req.membership.flatId) {
    account = await getFlatAccount(req.buildingId, req.membership.flatId);
  }

  res.json({
    bills: bills.map(mapBill),
    account,
    qrImageUrl: (
      await prisma.maintenanceConfig.findUnique({
        where: { buildingId: req.buildingId },
        select: { qrImageUrl: true }
      })
    )?.qrImageUrl || null
  });
});

router.post('/', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { flatId, flatNumber, month, amount, dueDate, breakdown, type, title } = req.body;
  if (!month || amount == null || !dueDate) {
    return res.status(400).json({ error: 'month, amount and dueDate are required' });
  }

  let resolvedFlatId = flatId;
  if (!resolvedFlatId && flatNumber) {
    const result = await resolveFlatInBuilding(prisma, req.buildingId, flatNumber);
    if (result.error) return res.status(404).json({ error: result.error });
    resolvedFlatId = result.flat.id;
  }
  if (!resolvedFlatId) return res.status(400).json({ error: 'flatId or flatNumber is required' });

  const bill = await createChargeAndApplyAdvance({
    buildingId: req.buildingId,
    flatId: resolvedFlatId,
    month,
    amount: Number(amount),
    dueDate,
    type: type || 'maintenance',
    title: title || `Maintenance · ${String(month).trim()}`,
    breakdown: breakdown || null
  });

  if (bill.status !== 'paid') {
    const body = `Flat ${bill.flat.number} · ₹${bill.amount.toLocaleString('en-IN')} due by ${new Date(bill.dueDate).toLocaleDateString('en-IN')}`;
    await notifyFlatResidents(prisma, req.buildingId, resolvedFlatId, {
      title: `Bill for ${bill.month} is due`,
      body,
      category: 'bill'
    });
    const building = await prisma.building.findUnique({
      where: { id: req.buildingId },
      select: { name: true }
    });
    await emailFlatResidents(
      prisma,
      req.buildingId,
      resolvedFlatId,
      ledgerEmail({
        title: `Bill for ${bill.month} is due`,
        body,
        flatNumber: bill.flat.number,
        buildingName: building?.name || 'Your society'
      })
    );
  }

  res.json(mapBill(bill));
});

router.post('/bulk', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { flatIds, flatNumbers, month, amount, dueDate, breakdown, type, title } = req.body;
  if (!month || amount == null || !dueDate) {
    return res.status(400).json({ error: 'month, amount and dueDate are required' });
  }

  const ids = new Set(Array.isArray(flatIds) ? flatIds.filter(Boolean) : []);
  const numbers = Array.isArray(flatNumbers) ? flatNumbers.filter(Boolean) : [];

  for (const flatNumber of numbers) {
    const result = await resolveFlatInBuilding(prisma, req.buildingId, flatNumber);
    if (result.error) {
      return res.status(404).json({ error: `${flatNumber}: ${result.error}` });
    }
    ids.add(result.flat.id);
  }

  if (ids.size === 0) {
    return res.status(400).json({ error: 'Select at least one flat' });
  }

  const created = [];
  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  for (const id of ids) {
    const bill = await createChargeAndApplyAdvance({
      buildingId: req.buildingId,
      flatId: id,
      month,
      amount: Number(amount),
      dueDate,
      type: type || 'maintenance',
      title: title || `Maintenance · ${String(month).trim()}`,
      breakdown: breakdown || null
    });

    if (bill.status !== 'paid') {
      const body = `Flat ${bill.flat.number} · ₹${bill.amount.toLocaleString('en-IN')} due by ${new Date(bill.dueDate).toLocaleDateString('en-IN')}`;
      await notifyFlatResidents(prisma, req.buildingId, id, {
        title: `Bill for ${bill.month} is due`,
        body,
        category: 'bill'
      });
      await emailFlatResidents(
        prisma,
        req.buildingId,
        id,
        ledgerEmail({
          title: `Bill for ${bill.month} is due`,
          body,
          flatNumber: bill.flat.number,
          buildingName: building?.name || 'Your society'
        })
      );
    }
    created.push(mapBill(bill));
  }

  res.json({ count: created.length, bills: created });
});

router.post('/:billId/pay', requireRole('resident'), optionalFinanceImage, async (req, res) => {
  // multer (optionalFinanceImage) has already written req.file to disk by the
  // time this handler runs, before any of the checks below — every early
  // return past this point must clean it up, or a resident retrying against
  // an already-paid/missing bill leaves an orphaned receipt on disk.
  const cleanupUploadedFile = () => {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  };

  const bill = await prisma.bill.findFirst({
    where: {
      id: req.params.billId,
      buildingId: req.buildingId,
      flatId: req.membership.flatId
    }
  });
  if (!bill) {
    cleanupUploadedFile();
    return res.status(404).json({ error: 'Bill not found' });
  }
  const remaining = remainingOnBill(bill);
  if (remaining <= 0) {
    cleanupUploadedFile();
    return res.status(400).json({ error: 'Bill already paid' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Payment screenshot is required to confirm payment' });
  }
  const receiptUrl = `/uploads/finance/${req.file.filename}`;

  try {
    const payment = await createPendingPayment({
      buildingId: req.buildingId,
      flatId: bill.flatId,
      billId: bill.id,
      amount: remaining,
      receiptUrl,
      method: 'upi',
      note: 'Resident submitted payment screenshot',
      receivedByUserId: req.user?.id || null
    });

    const flat = await prisma.flat.findUnique({
      where: { id: bill.flatId },
      select: { number: true }
    });
    await notifyBuildingAdmins(prisma, req.buildingId, {
      title: 'Payment awaiting review',
      body: `Flat ${flat?.number || '—'} · ₹${remaining.toLocaleString('en-IN')} · ${bill.title || bill.month}`,
      category: 'bill'
    });

    const building = await prisma.building.findUnique({
      where: { id: req.buildingId },
      select: { name: true }
    });
    await emailBuildingAdmins(
      prisma,
      req.buildingId,
      paymentAdminEmail({
        flatNumber: flat?.number || '—',
        amount: remaining,
        method: 'upi',
        note: `${bill.month} payment submitted — awaiting your review`,
        advanceBalance: 0,
        buildingId: req.buildingId,
        buildingName: building?.name || 'Your society'
      })
    );

    const updated = await prisma.bill.findUnique({
      where: { id: bill.id },
      include: {
        flat: true,
        payments: {
          where: { status: { in: ['approved', 'pending_review'] } },
          select: {
            id: true,
            receiptUrl: true,
            method: true,
            paidAt: true,
            amount: true,
            gateway: true,
            status: true
          },
          orderBy: { paidAt: 'desc' }
        }
      }
    });

    res.json({
      bill: mapBill(updated),
      payment: {
        id: payment.id,
        status: payment.status,
        receiptUrl: payment.receiptUrl
      },
      message: 'Payment submitted for admin review'
    });
  } catch (e) {
    cleanupUploadedFile();
    res.status(400).json({ error: e.message || 'Payment submission failed' });
  }
});

router.patch('/:billId/mark-paid', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const bill = await prisma.bill.findFirst({
    where: {
      id: req.params.billId,
      buildingId: req.buildingId,
      status: { in: ['due', 'partial'] }
    },
    include: { flat: true }
  });
  if (!bill) return res.status(404).json({ error: 'Pending bill not found' });

  const remaining = remainingOnBill(bill);
  const result = await recordFlatPayment({
    buildingId: req.buildingId,
    flatId: bill.flatId,
    amount: remaining,
    method: 'admin',
    gateway: 'manual-admin',
    txnId: `ADMIN-${Date.now()}`,
    preferBillId: bill.id,
    note: 'Marked paid by admin'
  });

  await notifyFlatResidents(prisma, req.buildingId, bill.flatId, {
    title: 'Bill cleared',
    body: `Your ${bill.month} bill for flat ${bill.flat.number} (₹${bill.amount.toLocaleString('en-IN')}) was marked paid by the admin.`,
    category: 'bill'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailFlatResidents(
    prisma,
    req.buildingId,
    bill.flatId,
    ledgerEmail({
      title: 'Bill cleared',
      body: `Your ${bill.month} bill for flat ${bill.flat.number} (₹${bill.amount.toLocaleString('en-IN')}) was marked paid by the admin.`,
      flatNumber: bill.flat.number,
      buildingName: building?.name || 'Your society'
    })
  );

  const updated = await prisma.bill.findUnique({ where: { id: bill.id }, include: { flat: true } });
  res.json({ bill: mapBill(updated), account: result.account });
});

module.exports = router;
