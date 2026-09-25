const VALID_BHK = new Set(['1bhk', '2bhk', '3bhk']);

function normalizeBhkType(value) {
  if (value == null || value === '') return null;
  const key = String(value).trim().toLowerCase().replace(/\s+/g, '');
  if (key === '1' || key === '1bhk' || key === '1bh') return '1bhk';
  if (key === '2' || key === '2bhk' || key === '2bh') return '2bhk';
  if (key === '3' || key === '3bhk' || key === '3bh') return '3bhk';
  if (VALID_BHK.has(key)) return key;
  return null;
}

function bhkLabel(bhkType) {
  if (bhkType === '1bhk') return '1 BHK';
  if (bhkType === '2bhk') return '2 BHK';
  if (bhkType === '3bhk') return '3 BHK';
  return 'Uncategorized';
}

/** Pick monthly maintenance amount for a flat from building config. */
function resolveMaintenanceAmount(config, flat) {
  const fallback = Number(config.amount) || 0;
  const bhk = flat?.bhkType || null;
  if (bhk === '1bhk' && config.amount1Bhk != null) return Number(config.amount1Bhk);
  if (bhk === '2bhk' && config.amount2Bhk != null) return Number(config.amount2Bhk);
  if (bhk === '3bhk' && config.amount3Bhk != null) return Number(config.amount3Bhk);
  return fallback;
}

module.exports = {
  VALID_BHK,
  normalizeBhkType,
  bhkLabel,
  resolveMaintenanceAmount
};
