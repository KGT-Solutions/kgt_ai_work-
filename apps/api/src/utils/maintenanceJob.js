const prisma = require('../lib/prisma');
const { createChargeAndApplyAdvance, periodKey } = require('../utils/finance');
const { notifyFlatResidents } = require('./notifications');
const { emailFlatResidents, ledgerEmail } = require('./emailNotify');
const { resolveMaintenanceAmount, bhkLabel } = require('./bhk');

async function getOccupiedFlats(buildingId) {
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
  const ids = rows.map((r) => r.flatId).filter(Boolean);
  if (!ids.length) return [];
  return prisma.flat.findMany({
    where: { id: { in: ids } },
    select: { id: true, number: true, bhkType: true }
  });
}

/**
 * Generate maintenance bills for a building for the given period (YYYY-MM).
 * Skips vacant flats and flats that already have a maintenance charge for the period.
 * Amount is based on flat BHK size when size rates are configured.
 */
async function generateMaintenanceForBuilding(buildingId, { period, forceDueDate } = {}) {
  const config = await prisma.maintenanceConfig.findUnique({ where: { buildingId } });
  if (!config || !config.active) {
    return { skipped: true, reason: 'No active maintenance config', created: [] };
  }

  const now = new Date();
  const targetPeriod = period || periodKey(now);

  if (config.startMonth && targetPeriod < config.startMonth) {
    return { skipped: true, reason: 'Before start month', created: [] };
  }

  const billingDay = Math.min(28, Math.max(1, Number(config.billingDay) || 1));
  const [year, month] = targetPeriod.split('-').map(Number);
  const dueDate = forceDueDate
    ? new Date(forceDueDate)
    : new Date(year, month - 1, billingDay, 12, 0, 0);

  const occupiedFlats = await getOccupiedFlats(buildingId);
  if (!occupiedFlats.length) {
    return { created: [], period: targetPeriod, amount: config.amount };
  }

  const existing = await prisma.bill.findMany({
    where: {
      buildingId,
      type: 'maintenance',
      month: targetPeriod,
      flatId: { in: occupiedFlats.map((f) => f.id) }
    },
    select: { flatId: true }
  });
  const already = new Set(existing.map((e) => e.flatId));
  const toCreate = occupiedFlats.filter((f) => !already.has(f.id));

  const created = [];
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    select: { name: true }
  });
  for (const flat of toCreate) {
    const amount = resolveMaintenanceAmount(config, flat);
    if (!(amount > 0)) continue;

    const sizeNote = flat.bhkType ? ` · ${bhkLabel(flat.bhkType)}` : '';
    const bill = await createChargeAndApplyAdvance({
      buildingId,
      flatId: flat.id,
      month: targetPeriod,
      amount,
      dueDate,
      type: 'maintenance',
      title: `Maintenance · ${targetPeriod}${sizeNote}`
    });

    const body = `Flat ${bill.flat.number}${sizeNote} · ₹${Number(bill.amount).toLocaleString('en-IN')} due by ${new Date(bill.dueDate).toLocaleDateString('en-IN')}`;
    await notifyFlatResidents(prisma, buildingId, flat.id, {
      title: `Maintenance bill for ${targetPeriod} is due`,
      body,
      category: 'bill'
    });
    await emailFlatResidents(
      prisma,
      buildingId,
      flat.id,
      ledgerEmail({
        title: `Maintenance bill for ${targetPeriod} is due`,
        body,
        flatNumber: bill.flat.number,
        buildingName: building?.name || 'Your society'
      })
    );

    created.push(bill);
  }

  return {
    created,
    period: targetPeriod,
    amount: config.amount,
    rates: {
      default: config.amount,
      '1bhk': config.amount1Bhk,
      '2bhk': config.amount2Bhk,
      '3bhk': config.amount3Bhk
    },
    skippedFlats: already.size
  };
}

/** Run for all buildings whose billing day has arrived this month. */
async function runDailyMaintenanceGeneration() {
  const now = new Date();
  const day = now.getDate();
  const period = periodKey(now);

  const configs = await prisma.maintenanceConfig.findMany({ where: { active: true } });
  const results = [];

  for (const config of configs) {
    const billingDay = Math.min(28, Math.max(1, Number(config.billingDay) || 1));
    if (day < billingDay) continue;
    try {
      const result = await generateMaintenanceForBuilding(config.buildingId, { period });
      results.push({ buildingId: config.buildingId, ...result });
    } catch (err) {
      console.error('[maintenance] generate failed', config.buildingId, err.message);
      results.push({ buildingId: config.buildingId, error: err.message });
    }
  }

  return results;
}

function startMaintenanceScheduler() {
  const HOUR = 60 * 60 * 1000;
  setTimeout(() => {
    runDailyMaintenanceGeneration().catch((e) => console.error('[maintenance] boot run', e));
  }, 5000);
  setInterval(() => {
    runDailyMaintenanceGeneration().catch((e) => console.error('[maintenance] hourly run', e));
  }, HOUR);
}

module.exports = {
  generateMaintenanceForBuilding,
  runDailyMaintenanceGeneration,
  startMaintenanceScheduler,
  getOccupiedFlats
};
