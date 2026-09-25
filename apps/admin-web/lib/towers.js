/** Display tower label — never show legacy "Wing" prefix in admin UI. */
export function displayTowerName(name) {
  if (!name) return 'Unknown';

  const towerHyphen = String(name).match(/^tower-(\d+)$/i);
  if (towerHyphen) {
    return `Tower-${String(parseInt(towerHyphen[1], 10)).padStart(2, '0')}`;
  }

  const towerSpace = String(name).match(/^tower\s+(\d+)$/i);
  if (towerSpace) {
    return `Tower-${String(parseInt(towerSpace[1], 10)).padStart(2, '0')}`;
  }

  const wingNum = String(name).match(/^wing\s+(\d+)$/i);
  if (wingNum) {
    return `Tower-${String(parseInt(wingNum[1], 10)).padStart(2, '0')}`;
  }

  const wingLetter = String(name).match(/^wing\s+([A-Z])$/i);
  if (wingLetter) {
    const n = wingLetter[1].toUpperCase().charCodeAt(0) - 64;
    return `Tower-${String(n).padStart(2, '0')}`;
  }

  return String(name).replace(/^wing\s+/i, 'Tower-');
}
