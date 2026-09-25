const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { optionalFinanceImage } = require('../middleware/upload');
const { notifyFlatResidents } = require('../utils/notifications');
const { emailFlatResidents, ledgerEmail } = require('../utils/emailNotify');
const {
  listFlatAccounts,
  getFlatAccount,
  getFlatLedger,
  recordFlatPayment,
  approvePendingPayment,
  rejectPendingPayment,
  createChargeAndApplyAdvance,
  remainingOnBill,
  periodKey,
  roundMoney
} = require('../utils/finance');
const { generateMaintenanceForBuilding } = require('../utils/maintenanceJob');
const router = express.Router();

function mapBill(b) {
  return {
    ...b,
    remaining: remainingOnBill(b),
    amountPaid: Number(b.amountPaid || 0)
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function truthyFlag(value) {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

// ── Maintenance config ──────────────────────────────────────────────

router.get('/maintenance-config', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const config = await prisma.maintenanceConfig.findUnique({ where: { buildingId: req.buildingId } });
  const flats = await prisma.flat.findMany({
    where: { wing: { buildingId: req.buildingId } },
    select: { bhkType: true }
  });
  const bhkCounts = { '1bhk': 0, '2bhk': 0, '3bhk': 0, uncategorized: 0 };
  for (const f of flats) {
    if (f.bhkType === '1bhk' || f.bhkType === '2bhk' || f.bhkType === '3bhk') bhkCounts[f.bhkType] += 1;
    else bhkCounts.uncategorized += 1;
  }

  res.json({
    ...(config || {
      buildingId: req.buildingId,
      amount: 0,
      amount1Bhk: null,
      amount2Bhk: null,
      amount3Bhk: null,
      billingDay: 1,
      active: false,
      startMonth: null,
      openingBalance: 0,
      qrImageUrl: null
    }),
    bhkCounts
  });
});

/** Society UPI/QR image for residents (and admins). */
router.get('/payment-qr', requireRole('resident', 'building_admin', 'committee_member'), async (req, res) => {
  const config = await prisma.maintenanceConfig.findUnique({
    where: { buildingId: req.buildingId },
    select: { qrImageUrl: true }
  });
  res.json({ qrImageUrl: config?.qrImageUrl || null });
});

/** Upload / replace society UPI/QR without requiring full maintenance setup. */
router.post('/payment-qr', requireRole('building_admin', 'committee_member'), optionalFinanceImage, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Society UPI / QR image is required' });
  }
  const qrImageUrl = `/uploads/finance/${req.file.filename}`;
  const config = await prisma.maintenanceConfig.upsert({
    where: { buildingId: req.buildingId },
    create: {
      buildingId: req.buildingId,
      amount: 0,
      billingDay: 1,
      active: false,
      openingBalance: 0,
      qrImageUrl
    },
    update: { qrImageUrl }
  });
  res.json({ qrImageUrl: config.qrImageUrl });
});

router.put('/payment-qr', requireRole('building_admin', 'committee_member'), optionalFinanceImage, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Society UPI / QR image is required' });
  }
  const qrImageUrl = `/uploads/finance/${req.file.filename}`;
  const config = await prisma.maintenanceConfig.upsert({
    where: { buildingId: req.buildingId },
    create: {
      buildingId: req.buildingId,
      amount: 0,
      billingDay: 1,
      active: false,
      openingBalance: 0,
      qrImageUrl
    },
    update: { qrImageUrl }
  });
  res.json({ qrImageUrl: config.qrImageUrl });
});

router.put(
  '/maintenance-config',
  requireRole('building_admin', 'committee_member'),
  optionalFinanceImage,
  async (req, res) => {
    const amount = Number(req.body.amount);
    const billingDay = Number(req.body.billingDay);
    if (!(amount >= 0) || Number.isNaN(amount)) {
      return res.status(400).json({ error: 'Default amount must be a non-negative number' });
    }
    if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
      return res.status(400).json({ error: 'billingDay must be an integer from 1 to 28' });
    }

    function optionalAmount(v) {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) return undefined;
      return n;
    }

    const amount1Bhk = optionalAmount(req.body.amount1Bhk);
    const amount2Bhk = optionalAmount(req.body.amount2Bhk);
    const amount3Bhk = optionalAmount(req.body.amount3Bhk);
    if (amount1Bhk === undefined || amount2Bhk === undefined || amount3Bhk === undefined) {
      return res.status(400).json({ error: 'BHK amounts must be blank or non-negative numbers' });
    }

    const data = {
      amount,
      amount1Bhk,
      amount2Bhk,
      amount3Bhk,
      billingDay,
      active: req.body.active !== false && req.body.active !== 'false',
      startMonth: req.body.startMonth ? String(req.body.startMonth).trim() : null,
      openingBalance:
        req.body.openingBalance != null && req.body.openingBalance !== ''
          ? Number(req.body.openingBalance)
          : undefined
    };

    const clearQr = truthyFlag(req.body.clearQrImage);
    const uploadedQr = req.file ? `/uploads/finance/${req.file.filename}` : null;

    if (clearQr && !uploadedQr) {
      return res.status(400).json({ error: 'Society UPI / QR image is required' });
    }

    const existing = await prisma.maintenanceConfig.findUnique({ where: { buildingId: req.buildingId } });
    const nextQr = uploadedQr || (clearQr ? null : existing?.qrImageUrl) || null;
    if (!nextQr) {
      return res.status(400).json({ error: 'Society UPI / QR image is required' });
    }

    let config;
    if (existing) {
      config = await prisma.maintenanceConfig.update({
        where: { buildingId: req.buildingId },
        data: {
          amount: data.amount,
          amount1Bhk: data.amount1Bhk,
          amount2Bhk: data.amount2Bhk,
          amount3Bhk: data.amount3Bhk,
          billingDay: data.billingDay,
          active: data.active,
          startMonth: data.startMonth,
          ...(data.openingBalance != null && !Number.isNaN(data.openingBalance)
            ? { openingBalance: data.openingBalance }
            : {}),
          qrImageUrl: nextQr
        }
      });
    } else {
      config = await prisma.maintenanceConfig.create({
        data: {
          buildingId: req.buildingId,
          amount: data.amount,
          amount1Bhk: data.amount1Bhk,
          amount2Bhk: data.amount2Bhk,
          amount3Bhk: data.amount3Bhk,
          billingDay: data.billingDay,
          active: data.active,
          startMonth: data.startMonth,
          openingBalance:
            data.openingBalance != null && !Number.isNaN(data.openingBalance) ? data.openingBalance : 0,
          qrImageUrl: nextQr
        }
      });
    }
    res.json(config);
  }
);

router.post('/generate-maintenance', requireRole('building_admin', 'committee_member'), async (req, res) => {
  try {
    const result = await generateMaintenanceForBuilding(req.buildingId, {
      period: req.body.period || undefined
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Generation failed' });
  }
});

// ── Flat accounts / collections ─────────────────────────────────────

router.get('/flat-accounts', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const accounts = await listFlatAccounts(req.buildingId);
  res.json(accounts);
});

router.get('/flat-accounts/:flatId', requireRole('building_admin', 'committee_member', 'resident'), async (req, res) => {
  if (req.membership?.role?.key === 'resident' && req.membership.flatId !== req.params.flatId) {
    return res.status(403).json({ error: 'Not your flat' });
  }
  const flat = await prisma.flat.findFirst({
    where: { id: req.params.flatId, wing: { buildingId: req.buildingId } }
  });
  if (!flat) return res.status(404).json({ error: 'Flat not found' });
  const account = await getFlatAccount(req.buildingId, flat.id);
  res.json({ ...account, flatNumber: flat.number });
});

router.get('/flat-accounts/:flatId/ledger', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const ledger = await getFlatLedger(req.buildingId, req.params.flatId);
  if (!ledger) return res.status(404).json({ error: 'Flat not found' });
  res.json(ledger);
});

router.post('/payments', requireRole('building_admin', 'committee_member'), optionalFinanceImage, async (req, res) => {
  const { flatId, amount, method, note, paidAt, billId } = req.body;
  if (!flatId || amount == null || amount === '') {
    return res.status(400).json({ error: 'flatId and amount are required' });
  }
  const flat = await prisma.flat.findFirst({
    where: { id: flatId, wing: { buildingId: req.buildingId } }
  });
  if (!flat) return res.status(404).json({ error: 'Flat not found' });

  if (!req.file) {
    return res.status(400).json({ error: 'Payment screenshot / receipt image is required' });
  }
  const receiptUrl = `/uploads/finance/${req.file.filename}`;

  try {
    const result = await recordFlatPayment({
      buildingId: req.buildingId,
      flatId,
      amount: Number(amount),
      method: method || 'admin',
      gateway: 'manual-admin',
      txnId: `ADMIN-${Date.now()}`,
      note: note || null,
      receiptUrl,
      paidAt: paidAt || null,
      receivedByUserId: req.user?.id || null,
      preferBillId: billId || null
    });

    await notifyFlatResidents(prisma, req.buildingId, flatId, {
      title: 'Payment recorded',
      body: `₹${Number(amount).toLocaleString('en-IN')} received for flat ${flat.number}${result.account.advanceBalance > 0 ? ` · Advance ₹${result.account.advanceBalance.toLocaleString('en-IN')}` : ''}`,
      category: 'bill'
    });

    const building = await prisma.building.findUnique({
      where: { id: req.buildingId },
      select: { name: true }
    });
    await emailFlatResidents(
      prisma,
      req.buildingId,
      flatId,
      ledgerEmail({
        title: 'Payment recorded',
        body: `₹${Number(amount).toLocaleString('en-IN')} received for flat ${flat.number}${result.account.advanceBalance > 0 ? ` · Advance ₹${result.account.advanceBalance.toLocaleString('en-IN')}` : ''}`,
        flatNumber: flat.number,
        buildingName: building?.name || 'Your society'
      })
    );

    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Payment failed' });
  }
});

// ── Society expenses ────────────────────────────────────────────────

async function resolveExpenseSplitFlats(buildingId, splitScope, { wingId, flatIds } = {}) {
  const scope = splitScope || 'all_occupied';

  if (scope === 'all_occupied') {
    const rows = await prisma.membership.findMany({
      where: {
        buildingId,
        status: 'approved',
        role: { key: 'resident' },
        flatId: { not: null }
      },
      distinct: ['flatId'],
      select: { flatId: true }
    });
    return rows.map((r) => r.flatId);
  }

  if (scope === 'all_flats') {
    const flats = await prisma.flat.findMany({
      where: { wing: { buildingId } },
      select: { id: true }
    });
    return flats.map((f) => f.id);
  }

  if (scope === 'wing') {
    if (!wingId) throw new Error('wingId required for wing split');
    const flats = await prisma.flat.findMany({
      where: { wingId, wing: { buildingId } },
      select: { id: true }
    });
    const occupied = await prisma.membership.findMany({
      where: {
        buildingId,
        status: 'approved',
        role: { key: 'resident' },
        flatId: { in: flats.map((f) => f.id) }
      },
      distinct: ['flatId'],
      select: { flatId: true }
    });
    return occupied.map((r) => r.flatId);
  }

  if (scope === 'selected_flats') {
    const ids = Array.isArray(flatIds) ? flatIds.filter(Boolean) : [];
    if (!ids.length) throw new Error('Select at least one flat');
    const flats = await prisma.flat.findMany({
      where: { id: { in: ids }, wing: { buildingId } },
      select: { id: true }
    });
    return flats.map((f) => f.id);
  }

  throw new Error('Invalid splitScope');
}

async function createSplitBillsForExpense({
  buildingId,
  expense,
  targetFlatIds,
  category,
  vendor,
  value,
  paidAt
}) {
  const createdBills = [];
  const share = roundMoney(value / targetFlatIds.length);
  let allocated = 0;
  const period = periodKey(paidAt ? new Date(paidAt) : new Date());
  const title = `${category}${vendor ? ` · ${vendor}` : ''}`;

  for (let i = 0; i < targetFlatIds.length; i++) {
    const flatId = targetFlatIds[i];
    const isLast = i === targetFlatIds.length - 1;
    const shareAmount = isLast ? roundMoney(value - allocated) : share;
    allocated = roundMoney(allocated + shareAmount);

    const bill = await createChargeAndApplyAdvance({
      buildingId,
      flatId,
      month: period,
      amount: shareAmount,
      dueDate: paidAt || new Date(),
      type: 'misc_split',
      title,
      breakdown: JSON.stringify({ expenseId: expense.id, category, totalExpense: value }),
      sourceExpenseId: expense.id
    });

    await notifyFlatResidents(prisma, buildingId, flatId, {
      title: `New charge: ${title}`,
      body: `Flat ${bill.flat.number} · ₹${shareAmount.toLocaleString('en-IN')} (shared expense)`,
      category: 'bill'
    });

    const building = await prisma.building.findUnique({
      where: { id: buildingId },
      select: { name: true }
    });
    await emailFlatResidents(
      prisma,
      buildingId,
      flatId,
      ledgerEmail({
        title: `New charge: ${title}`,
        body: `Flat ${bill.flat.number} · ₹${shareAmount.toLocaleString('en-IN')} (shared expense)`,
        flatNumber: bill.flat.number,
        buildingName: building?.name || 'Your society'
      })
    );

    createdBills.push(bill);
  }

  return createdBills;
}

function modeLabel(expense) {
  if (expense.mode === 'fund') return 'Fund expense';
  if (expense.splitScope === 'all_flats') return 'Split · all flats';
  if (expense.splitScope === 'all_occupied') return 'Split · occupied';
  if (expense.splitScope === 'wing') return 'Split · wing';
  if (expense.splitScope === 'selected_flats') return 'Split · selected';
  return expense.mode;
}

router.get('/expenses', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const expenses = await prisma.societyExpense.findMany({
    where: { buildingId: req.buildingId },
    include: {
      bills: {
        select: {
          id: true,
          flatId: true,
          amount: true,
          amountPaid: true,
          status: true,
          flat: { select: { number: true } }
        }
      }
    },
    orderBy: { paidAt: 'desc' }
  });
  res.json(
    expenses.map((e) => ({
      ...e,
      modeLabel: modeLabel(e),
      canEditAmount: e.mode === 'fund' || !(e.bills || []).some((b) => Number(b.amountPaid || 0) > 0),
      canDelete: e.mode === 'fund' || !(e.bills || []).some((b) => Number(b.amountPaid || 0) > 0)
    }))
  );
});

router.post('/expenses', requireRole('building_admin', 'committee_member'), optionalFinanceImage, async (req, res) => {
  const {
    category,
    vendor,
    description,
    invoiceNo,
    amount,
    paidAt,
    mode,
    splitScope,
    wingId,
    remarks
  } = req.body;
  const flatIds = parseJsonArray(req.body.flatIds);

  if (!category || amount == null || amount === '' || !mode) {
    return res.status(400).json({ error: 'category, amount and mode are required' });
  }
  if (!['fund', 'recoverable'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be fund or recoverable' });
  }

  const value = roundMoney(Number(amount));
  if (!(value > 0)) return res.status(400).json({ error: 'amount must be greater than 0' });

  let targetFlatIds = [];
  let resolvedScope = null;

  if (mode === 'recoverable') {
    resolvedScope = splitScope || 'all_occupied';
    try {
      targetFlatIds = await resolveExpenseSplitFlats(req.buildingId, resolvedScope, { wingId, flatIds });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (!targetFlatIds.length) {
      return res.status(400).json({ error: 'No flats to split this expense across' });
    }
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Invoice / proof image is required' });
  }
  const imageUrl = `/uploads/finance/${req.file.filename}`;

  const expense = await prisma.societyExpense.create({
    data: {
      buildingId: req.buildingId,
      category: String(category).trim(),
      vendor: vendor || null,
      description: description || null,
      invoiceNo: invoiceNo || null,
      amount: value,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      mode,
      splitScope: mode === 'recoverable' ? resolvedScope : null,
      wingId: mode === 'recoverable' && resolvedScope === 'wing' ? wingId : null,
      remarks: remarks || null,
      imageUrl
    }
  });

  let createdBills = [];
  if (mode === 'recoverable') {
    createdBills = await createSplitBillsForExpense({
      buildingId: req.buildingId,
      expense,
      targetFlatIds,
      category: expense.category,
      vendor: expense.vendor,
      value,
      paidAt: expense.paidAt
    });
  }

  res.json({ expense, bills: createdBills, splitCount: createdBills.length });
});

router.patch(
  '/expenses/:expenseId',
  requireRole('building_admin', 'committee_member'),
  optionalFinanceImage,
  async (req, res) => {
    const expense = await prisma.societyExpense.findFirst({
      where: { id: req.params.expenseId, buildingId: req.buildingId },
      include: { bills: true }
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const { category, vendor, description, remarks, paidAt, amount } = req.body;
    const hasPaidBills = expense.bills.some((b) => Number(b.amountPaid || 0) > 0);

    const data = {};
    if (category !== undefined) data.category = String(category).trim();
    if (vendor !== undefined) data.vendor = vendor || null;
    if (description !== undefined) data.description = description || null;
    if (remarks !== undefined) data.remarks = remarks || null;
    if (paidAt !== undefined) data.paidAt = paidAt ? new Date(paidAt) : expense.paidAt;

    if (amount !== undefined && amount !== '') {
      const value = roundMoney(Number(amount));
      if (!(value > 0)) return res.status(400).json({ error: 'amount must be greater than 0' });
      if (expense.mode === 'recoverable' && hasPaidBills) {
        return res.status(400).json({
          error: 'Cannot change amount — some flats have already paid this charge'
        });
      }
      data.amount = value;
    }

    if (truthyFlag(req.body.clearImage) && !req.file) {
      return res.status(400).json({ error: 'Invoice / proof image is required' });
    }
    if (req.file) {
      data.imageUrl = `/uploads/finance/${req.file.filename}`;
    } else if (!expense.imageUrl) {
      return res.status(400).json({ error: 'Invoice / proof image is required' });
    }

    await prisma.societyExpense.update({
      where: { id: expense.id },
      data
    });

    const nextCategory = data.category ?? expense.category;
    const nextVendor = data.vendor !== undefined ? data.vendor : expense.vendor;
    const title = `${nextCategory}${nextVendor ? ` · ${nextVendor}` : ''}`;

    if (expense.mode === 'recoverable' && expense.bills.length) {
      if (data.amount != null && !hasPaidBills) {
        const value = data.amount;
        const share = roundMoney(value / expense.bills.length);
        let allocated = 0;
        for (let i = 0; i < expense.bills.length; i++) {
          const bill = expense.bills[i];
          const isLast = i === expense.bills.length - 1;
          const shareAmount = isLast ? roundMoney(value - allocated) : share;
          allocated = roundMoney(allocated + shareAmount);
          await prisma.bill.update({
            where: { id: bill.id },
            data: {
              amount: shareAmount,
              title,
              breakdown: JSON.stringify({
                expenseId: expense.id,
                category: nextCategory,
                totalExpense: value
              })
            }
          });
        }
      } else if (category !== undefined || vendor !== undefined) {
        await prisma.bill.updateMany({
          where: { sourceExpenseId: expense.id },
          data: { title }
        });
      }
    }

    const full = await prisma.societyExpense.findUnique({
      where: { id: expense.id },
      include: {
        bills: {
          select: {
            id: true,
            flatId: true,
            amount: true,
            amountPaid: true,
            status: true,
            flat: { select: { number: true } }
          }
        }
      }
    });

    res.json({
      ...full,
      modeLabel: modeLabel(full),
      canEditAmount: full.mode === 'fund' || !(full.bills || []).some((b) => Number(b.amountPaid || 0) > 0),
      canDelete: full.mode === 'fund' || !(full.bills || []).some((b) => Number(b.amountPaid || 0) > 0)
    });
  }
);

router.delete('/expenses/:expenseId', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const expense = await prisma.societyExpense.findFirst({
    where: { id: req.params.expenseId, buildingId: req.buildingId },
    include: { bills: true }
  });
  if (!expense) return res.status(404).json({ error: 'Expense not found' });

  const paidBills = expense.bills.filter((b) => Number(b.amountPaid || 0) > 0);
  if (paidBills.length) {
    return res.status(400).json({
      error: 'Cannot delete — residents have already paid part of this expense'
    });
  }

  const billIds = expense.bills.map((b) => b.id);
  await prisma.$transaction(async (tx) => {
    if (billIds.length) {
      await tx.paymentAllocation.deleteMany({ where: { billId: { in: billIds } } });
      await tx.bill.deleteMany({ where: { id: { in: billIds } } });
    }
    await tx.societyExpense.delete({ where: { id: expense.id } });
  });

  res.json({ ok: true });
});

// ── Pending resident payment reviews ────────────────────────────────

router.get('/payment-reviews', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const rows = await prisma.payment.findMany({
    where: { buildingId: req.buildingId, status: 'pending_review' },
    include: {
      flat: { select: { id: true, number: true } },
      bill: { select: { id: true, title: true, month: true, amount: true, type: true } }
    },
    orderBy: { paidAt: 'desc' }
  });
  res.json(rows);
});

router.post('/payment-reviews/:paymentId/approve', requireRole('building_admin', 'committee_member'), async (req, res) => {
  try {
    const result = await approvePendingPayment({
      paymentId: req.params.paymentId,
      buildingId: req.buildingId,
      reviewedByUserId: req.user?.id || null
    });

    const payment = result.payment;
    await notifyFlatResidents(prisma, req.buildingId, payment.flatId, {
      title: 'Payment approved',
      body: `₹${Number(payment.amount).toLocaleString('en-IN')} payment was approved and applied to your bills`,
      category: 'bill'
    });

    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Approve failed' });
  }
});

router.post('/payment-reviews/:paymentId/reject', requireRole('building_admin', 'committee_member'), async (req, res) => {
  try {
    const payment = await rejectPendingPayment({
      paymentId: req.params.paymentId,
      buildingId: req.buildingId,
      reviewedByUserId: req.user?.id || null
    });

    await notifyFlatResidents(prisma, req.buildingId, payment.flatId, {
      title: 'Payment rejected',
      body: `Your ₹${Number(payment.amount).toLocaleString('en-IN')} payment proof was rejected. Please pay again with a clear screenshot.`,
      category: 'bill'
    });

    res.json({ payment });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Reject failed' });
  }
});

// ── Fund summary ────────────────────────────────────────────────────

router.get('/fund-summary', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const config = await prisma.maintenanceConfig.findUnique({ where: { buildingId: req.buildingId } });
  const openingBalance = config?.openingBalance || 0;

  const [payments, fundExpenses, expenseAttachments, paymentAttachments] = await Promise.all([
    prisma.payment.findMany({
      where: { buildingId: req.buildingId, status: 'approved' },
      select: { amount: true, paidAt: true }
    }),
    prisma.societyExpense.findMany({
      where: { buildingId: req.buildingId, mode: 'fund' },
      select: { amount: true, paidAt: true, category: true }
    }),
    prisma.societyExpense.findMany({
      where: { buildingId: req.buildingId, imageUrl: { not: null } },
      select: {
        id: true,
        category: true,
        vendor: true,
        amount: true,
        paidAt: true,
        imageUrl: true,
        mode: true
      },
      orderBy: { paidAt: 'desc' },
      take: 40
    }),
    prisma.payment.findMany({
      where: { buildingId: req.buildingId, status: 'approved', receiptUrl: { not: null } },
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        receiptUrl: true,
        flat: { select: { number: true } }
      },
      orderBy: { paidAt: 'desc' },
      take: 40
    })
  ]);

  const byMonth = {};
  function ensure(key) {
    if (!byMonth[key]) byMonth[key] = { month: key, collection: 0, expenses: 0 };
    return byMonth[key];
  }

  for (const p of payments) {
    const key = periodKey(p.paidAt);
    ensure(key).collection = roundMoney(ensure(key).collection + Number(p.amount));
  }
  for (const e of fundExpenses) {
    const key = periodKey(e.paidAt);
    ensure(key).expenses = roundMoney(ensure(key).expenses + Number(e.amount));
  }

  const months = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  let running = openingBalance;
  const register = months.map((m) => {
    const net = roundMoney(m.collection - m.expenses);
    running = roundMoney(running + net);
    return {
      ...m,
      net,
      closingBalance: running
    };
  });

  const totalCollection = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
  const totalExpenses = roundMoney(fundExpenses.reduce((s, e) => s + Number(e.amount), 0));
  const closingBalance = roundMoney(openingBalance + totalCollection - totalExpenses);

  const accounts = await listFlatAccounts(req.buildingId);
  const totalDue = roundMoney(accounts.reduce((s, a) => s + a.dueBalance, 0));
  const totalAdvance = roundMoney(accounts.reduce((s, a) => s + a.advanceBalance, 0));

  res.json({
    openingBalance,
    totalCollection,
    totalExpenses,
    closingBalance,
    totalDue,
    totalAdvance,
    register,
    duesFlats: accounts.filter((a) => a.dueBalance > 0),
    advanceFlats: accounts.filter((a) => a.advanceBalance > 0),
    qrImageUrl: config?.qrImageUrl || null,
    expenseAttachments,
    paymentAttachments
  });
});

module.exports = router;
module.exports.mapBill = mapBill;
