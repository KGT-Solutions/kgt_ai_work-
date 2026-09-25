function normalizeFlatInput(input) {
  const raw = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return null;

  const withPrefix = raw.match(/^([A-Z])-?(\d+)$/);
  if (withPrefix) return `${withPrefix[1]}-${withPrefix[2]}`;

  if (/^\d+$/.test(raw)) return { digits: raw };
  return raw;
}

function normalizeFloorLetter(input, defaultLetter = 'A') {
  const letter = String(input || defaultLetter).trim().toUpperCase().replace(/[^A-Z]/g, '');
  return letter.charAt(0) || 'A';
}

/** Infer floor: A-101 → 1 (letter), legacy 205 → 2 (digits). */
function inferFloorFromFlatNumber(flatNumber) {
  const raw = String(flatNumber || '').trim().toUpperCase();
  const letterMatch = raw.match(/^([A-Z])-(\d+)$/);
  if (letterMatch) {
    const floor = letterMatch[1].charCodeAt(0) - 64;
    if (floor >= 1 && floor <= 26) return floor;
  }

  const digits = raw.match(/(\d+)$/)?.[1];
  if (!digits) return null;
  if (digits.length <= 2) return Number(digits) || null;
  const floor = Number(digits.slice(0, -2));
  return Number.isFinite(floor) && floor > 0 ? floor : null;
}

function flatNumberCandidatesForDigits(digits) {
  const candidates = new Set();
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    candidates.add(`${letter}-${digits}`);
    if (digits.length <= 2) {
      candidates.add(`${letter}-${100 + parseInt(digits, 10)}`);
    }
  }
  return candidates;
}

async function resolveFlatInBuilding(prisma, buildingId, flatNumber) {
  const normalized = normalizeFlatInput(flatNumber);

  if (typeof normalized === 'string') {
    const flat = await prisma.flat.findFirst({
      where: { number: normalized, wing: { buildingId } }
    });
    if (flat) return { flat };
  }

  if (normalized && normalized.digits) {
    const matches = [];
    for (const number of flatNumberCandidatesForDigits(normalized.digits)) {
      const flat = await prisma.flat.findFirst({
        where: { number, wing: { buildingId } }
      });
      if (flat) matches.push(flat);
    }

    const unique = [...new Map(matches.map((f) => [f.id, f])).values()];
    if (unique.length === 1) return { flat: unique[0] };
    if (unique.length > 1) {
      return {
        error: `Multiple flats match "${flatNumber}". Specify the full flat number, e.g. ${unique.slice(0, 3).map((f) => f.number).join(', ')}`
      };
    }
  }

  const examples = await prisma.flat.findMany({
    where: { wing: { buildingId } },
    orderBy: { number: 'asc' },
    take: 3,
    select: { number: true }
  });
  const hint = examples.length ? examples.map((f) => f.number).join(', ') : 'A-101';
  return {
    error: `Flat not found. Use format FloorLetter-Number (e.g. ${hint}).`
  };
}

module.exports = {
  normalizeFlatInput,
  normalizeFloorLetter,
  resolveFlatInBuilding,
  inferFloorFromFlatNumber,
  flatNumberCandidatesForDigits
};
