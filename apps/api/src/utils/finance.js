const prisma = require('../lib/prisma');

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function remainingOnBill(bill) {
  return roundMoney(Math.max(0, Number(bill.amount) - Number(bill.amountPaid || 0)));
}

function billStatusFromPaid(amount, amountPaid) {
  const paid = Number(amountPaid || 0);
  if (paid <= 0) return 'due';
  if (paid + 0.001 >= Number(amount)) return 'paid';
  return 'partial';
}

async function getFlatPaymentsAndBills(buildingId, flatId) {
  const [bills, payments] = await Promise.all([
    prisma.bill.findMany({
      where: { buildingId, flatId },
      orderBy: [{ dueDate: 'asc' }, { month: 'asc' }]
    }),
    prisma.payment.findMany({
      where: { buildingId, flatId, status: 'approved' },
      include: { allocations: true },
      orderBy: { paidAt: 'asc' }
    })
  ]);
  return { bills, payments };
}

function computeFlatBalance(bills, payments) {
  const dueBalance = roundMoney(
    bills.reduce((sum, b) => sum + remainingOnBill(b), 0)
  );
  const totalPaid = roundMoney(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  const totalAllocated = roundMoney(
    payments.reduce(
      (sum, p) => sum + (p.allocations || []).reduce((s, a) => s + Number(a.amount), 0),
      0
    )
  );
  const advanceBalance = roundMoney(Math.max(0, totalPaid - totalAllocated));
  return { dueBalance, advanceBalance, totalPaid, totalAllocated };
}

async function getFlatAccount(buildingId, flatId) {
  const { bills, payments } = await getFlatPaymentsAndBills(buildingId, flatId);
  const balance = computeFlatBalance(bills, payments);
  return {
    flatId,
    ...balance,
    openBills: bills
      .filter((b) => remainingOnBill(b) > 0)
      .map((b) => ({
        id: b.id,
        month: b.month,
        type: b.type,
        title: b.title,
        amount: b.amount,
        amountPaid: b.amountPaid,
        remaining: remainingOnBill(b),
        dueDate: b.dueDate,
        status: b.status
      }))
  };
}

/** Apply unallocated advance on a flat to open bills (oldest first). */
async function applyAdvanceToCharges(buildingId, flatId, { tx } = {}) {
  const db = tx || prisma;
  const payments = await db.payment.findMany({
    where: { buildingId, flatId, status: 'approved' },
    include: { allocations: true },
    orderBy: { paidAt: 'asc' }
  });

  const openBills = await db.bill.findMany({
    where: {
      buildingId,
      flatId,
      status: { in: ['due', 'partial'] }
    },
    orderBy: [{ dueDate: 'asc' }, { month: 'asc' }]
  });

  for (const payment of payments) {
    const allocated = roundMoney(
      (payment.allocations || []).reduce((s, a) => s + Number(a.amount), 0)
    );
    let leftover = roundMoney(Number(payment.amount) - allocated);
    if (leftover <= 0) continue;

    for (const bill of openBills) {
      if (leftover <= 0) break;
      const remaining = remainingOnBill(bill);
      if (remaining <= 0) continue;

      const apply = roundMoney(Math.min(leftover, remaining));
      await db.paymentAllocation.create({
        data: { paymentId: payment.id, billId: bill.id, amount: apply }
      });
      const amountPaid = roundMoney(Number(bill.amountPaid || 0) + apply);
      const status = billStatusFromPaid(bill.amount, amountPaid);
      await db.bill.update({
        where: { id: bill.id },
        data: { amountPaid, status }
      });
      bill.amountPaid = amountPaid;
      bill.status = status;
      leftover = roundMoney(leftover - apply);
    }
  }
}

/**
 * Record a payment for a flat and allocate to open charges; leftover becomes advance.
 */
async function recordFlatPayment({
  buildingId,
  flatId,
  amount,
  method = 'admin',
  gateway = null,
  txnId = null,
  note = null,
  receiptUrl = null,
  receivedByUserId = null,
  paidAt = null,
  preferBillId = null
}) {
  const value = roundMoney(amount);
  if (!(value > 0)) throw new Error('Payment amount must be greater than 0');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        buildingId,
        flatId,
        billId: preferBillId || null,
        amount: value,
        method,
        gateway,
        txnId,
        note,
        receiptUrl,
        status: 'approved',
        receivedByUserId,
        paidAt: paidAt ? new Date(paidAt) : new Date()
      }
    });

    let leftover = value;
    const openWhere = {
      buildingId,
      flatId,
      status: { in: ['due', 'partial'] }
    };

    let openBills = await tx.bill.findMany({
      where: openWhere,
      orderBy: [{ dueDate: 'asc' }, { month: 'asc' }]
    });

    if (preferBillId) {
      openBills = [
        ...openBills.filter((b) => b.id === preferBillId),
        ...openBills.filter((b) => b.id !== preferBillId)
      ];
    }

    for (const bill of openBills) {
      if (leftover <= 0) break;
      const remaining = remainingOnBill(bill);
      if (remaining <= 0) continue;
      const apply = roundMoney(Math.min(leftover, remaining));
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, billId: bill.id, amount: apply }
      });
      const amountPaid = roundMoney(Number(bill.amountPaid || 0) + apply);
      const status = billStatusFromPaid(bill.amount, amountPaid);
      await tx.bill.update({
        where: { id: bill.id },
        data: { amountPaid, status }
      });
      leftover = roundMoney(leftover - apply);
    }

    // If payment was tied to a specific bill that is now settled, clear prefer only
    if (preferBillId && leftover <= 0) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { billId: preferBillId }
      });
    }

    const bills = await tx.bill.findMany({ where: { buildingId, flatId } });
    const payments = await tx.payment.findMany({
      where: { buildingId, flatId, status: 'approved' },
      include: { allocations: true }
    });
    const balance = computeFlatBalance(bills, payments);

    return {
      payment,
      leftoverAdvance: leftover,
      account: { flatId, ...balance }
    };
  });
}

async function createChargeAndApplyAdvance({
  buildingId,
  flatId,
  month,
  amount,
  dueDate,
  type = 'maintenance',
  title = null,
  breakdown = null,
  sourceExpenseId = null
}) {
  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        buildingId,
        flatId,
        month: String(month).trim(),
        amount: roundMoney(amount),
        amountPaid: 0,
        dueDate: new Date(dueDate),
        status: 'due',
        type,
        title,
        breakdown,
        sourceExpenseId,
      },
      include: { flat: true }
    });
    await applyAdvanceToCharges(buildingId, flatId, { tx });
    return tx.bill.findUnique({
      where: { id: created.id },
      include: { flat: true }
    });
  });
  return bill;
}

async function listFlatAccounts(buildingId) {
  const flats = await prisma.flat.findMany({
    where: { wing: { buildingId } },
    include: {
      wing: { select: { id: true, name: true } },
      memberships: {
        where: { status: 'approved', role: { key: 'resident' } },
        include: { user: { select: { id: true, name: true, phone: true } } }
      }
    },
    orderBy: { number: 'asc' }
  });

  const [bills, payments] = await Promise.all([
    prisma.bill.findMany({ where: { buildingId } }),
    prisma.payment.findMany({
      where: { buildingId, status: 'approved' },
      include: { allocations: true }
    })
  ]);

  const billsByFlat = {};
  for (const b of bills) {
    if (!billsByFlat[b.flatId]) billsByFlat[b.flatId] = [];
    billsByFlat[b.flatId].push(b);
  }
  const paymentsByFlat = {};
  for (const p of payments) {
    if (!paymentsByFlat[p.flatId]) paymentsByFlat[p.flatId] = [];
    paymentsByFlat[p.flatId].push(p);
  }

  return flats.map((f) => {
    const balance = computeFlatBalance(billsByFlat[f.id] || [], paymentsByFlat[f.id] || []);
    // Positive = flat owes society; negative = advance held
    const netBalance = roundMoney(balance.dueBalance - balance.advanceBalance);
    return {
      flatId: f.id,
      flatNumber: f.number,
      floor: f.floor,
      wing: f.wing.name,
      wingId: f.wing.id,
      occupied: f.memberships.length > 0,
      residents: f.memberships.map((m) => ({
        name: m.user.name,
        phone: m.user.phone
      })),
      ...balance,
      netBalance
    };
  });
}

function billReason(bill) {
  if (bill.title?.trim()) return bill.title.trim();
  if (bill.type === 'misc_split') return `Shared expense · ${bill.month}`;
  if (bill.type === 'adjustment') return `Adjustment · ${bill.month}`;
  return `Maintenance · ${bill.month}`;
}

function paymentReason(payment) {
  const method = String(payment.method || 'payment').toUpperCase();
  if (payment.note?.trim()) return `${method} · ${payment.note.trim()}`;
  return `Payment received · ${method}`;
}

/**
 * Chronological flat ledger: debits (charges) and credits (payments) with running balance.
 * Running balance convention: positive = due (flat owes), negative = advance (credit balance).
 */
async function getFlatLedger(buildingId, flatId) {
  const flat = await prisma.flat.findFirst({
    where: { id: flatId, wing: { buildingId } },
    include: {
      wing: { select: { name: true } },
      memberships: {
        where: { status: 'approved', role: { key: 'resident' } },
        include: { user: { select: { name: true, phone: true } } }
      }
    }
  });
  if (!flat) return null;

  const { bills, payments } = await getFlatPaymentsAndBills(buildingId, flatId);
  const balance = computeFlatBalance(bills, payments);

  const raw = [
    ...bills.map((b) => ({
      id: `bill-${b.id}`,
      refType: 'bill',
      refId: b.id,
      date: new Date(b.dueDate),
      sortKey: new Date(b.dueDate).getTime(),
      debit: roundMoney(b.amount),
      credit: 0,
      reason: billReason(b),
      meta: { month: b.month, type: b.type, status: b.status }
    })),
    ...payments.map((p) => ({
      id: `payment-${p.id}`,
      refType: 'payment',
      refId: p.id,
      date: new Date(p.paidAt),
      sortKey: new Date(p.paidAt).getTime(),
      debit: 0,
      credit: roundMoney(p.amount),
      reason: paymentReason(p),
      meta: { method: p.method, note: p.note, receiptUrl: p.receiptUrl || null }
    }))
  ].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    // Charges before payments on the same day so balance reflects charge then settlement
    if (a.refType !== b.refType) return a.refType === 'bill' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  let running = 0;
  const entries = raw.map((row) => {
    running = roundMoney(running + row.debit - row.credit);
    return {
      id: row.id,
      refType: row.refType,
      refId: row.refId,
      date: row.date,
      reason: row.reason,
      debit: row.debit > 0 ? row.debit : null,
      credit: row.credit > 0 ? row.credit : null,
      balance: running,
      meta: row.meta
    };
  });

  const netBalance = roundMoney(balance.dueBalance - balance.advanceBalance);

  return {
    flatId: flat.id,
    flatNumber: flat.number,
    wing: flat.wing?.name || null,
    residents: flat.memberships.map((m) => ({
      name: m.user.name,
      phone: m.user.phone
    })),
    dueBalance: balance.dueBalance,
    advanceBalance: balance.advanceBalance,
    netBalance,
    totalDebit: roundMoney(bills.reduce((s, b) => s + Number(b.amount), 0)),
    totalCredit: roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0)),
    entries
  };
}

function periodKey(date = new Date()) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Resident UPI proof — waiting for admin review (does not settle the bill yet). */
async function createPendingPayment({
  buildingId,
  flatId,
  amount,
  billId,
  receiptUrl,
  method = 'upi',
  note = null,
  receivedByUserId = null
}) {
  const value = roundMoney(amount);
  if (!(value > 0)) throw new Error('Payment amount must be greater than 0');
  if (!receiptUrl) throw new Error('Payment screenshot is required');
  if (!billId) throw new Error('billId is required');

  const existing = await prisma.payment.findFirst({
    where: { buildingId, billId, status: 'pending_review' }
  });
  if (existing) {
    throw new Error('A payment for this bill is already waiting for admin review');
  }

  return prisma.payment.create({
    data: {
      buildingId,
      flatId,
      billId,
      amount: value,
      method,
      gateway: 'resident-app',
      txnId: `PEND-${Date.now()}`,
      note: note || 'Resident submitted payment screenshot',
      receiptUrl,
      status: 'pending_review',
      receivedByUserId,
      paidAt: new Date()
    }
  });
}

/** Admin approves pending payment → allocate to bills / enter ledger. */
async function approvePendingPayment({ paymentId, buildingId, reviewedByUserId = null }) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, buildingId, status: 'pending_review' }
    });
    if (!payment) throw new Error('Pending payment not found');

    let leftover = roundMoney(Number(payment.amount));
    const openWhere = {
      buildingId,
      flatId: payment.flatId,
      status: { in: ['due', 'partial'] }
    };

    let openBills = await tx.bill.findMany({
      where: openWhere,
      orderBy: [{ dueDate: 'asc' }, { month: 'asc' }]
    });

    if (payment.billId) {
      openBills = [
        ...openBills.filter((b) => b.id === payment.billId),
        ...openBills.filter((b) => b.id !== payment.billId)
      ];
    }

    for (const bill of openBills) {
      if (leftover <= 0) break;
      const remaining = remainingOnBill(bill);
      if (remaining <= 0) continue;
      const apply = roundMoney(Math.min(leftover, remaining));
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, billId: bill.id, amount: apply }
      });
      const amountPaid = roundMoney(Number(bill.amountPaid || 0) + apply);
      const status = billStatusFromPaid(bill.amount, amountPaid);
      await tx.bill.update({
        where: { id: bill.id },
        data: { amountPaid, status }
      });
      leftover = roundMoney(leftover - apply);
    }

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
        reviewedByUserId
      }
    });

    const bills = await tx.bill.findMany({ where: { buildingId, flatId: payment.flatId } });
    const payments = await tx.payment.findMany({
      where: { buildingId, flatId: payment.flatId, status: 'approved' },
      include: { allocations: true }
    });
    const balance = computeFlatBalance(bills, payments);

    return {
      payment: updated,
      leftoverAdvance: leftover,
      account: { flatId: payment.flatId, ...balance }
    };
  });
}

async function rejectPendingPayment({ paymentId, buildingId, reviewedByUserId = null }) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, buildingId, status: 'pending_review' }
  });
  if (!payment) throw new Error('Pending payment not found');

  return prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedByUserId
    }
  });
}

module.exports = {
  roundMoney,
  remainingOnBill,
  billStatusFromPaid,
  getFlatAccount,
  getFlatLedger,
  listFlatAccounts,
  computeFlatBalance,
  applyAdvanceToCharges,
  recordFlatPayment,
  createPendingPayment,
  approvePendingPayment,
  rejectPendingPayment,
  createChargeAndApplyAdvance,
  periodKey
};
