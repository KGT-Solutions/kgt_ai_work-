// Client-side mirror of botAuditor.recomputeReadiness (apps/api/src/services/
// botAuditor.js). When a user dismisses a gap ("Optional / Not applicable"), its
// share of its pillar's shortfall is removed from the score's maximum — so the
// SAME earned points become a higher %, instantly and with no API round-trip. The
// backend runs the identical formula when persisting, so the numbers match.

export const READY_AT = 80;
export const MODERATE_AT = 50;

export function levelFor(score) {
  return score >= READY_AT ? 'Production Ready' : score >= MODERATE_AT ? 'Moderate' : 'Not Ready';
}

// ignored: a Set or array of requirementItem keys (`${bot}:${index}`).
export function applyIgnoredRequirements(report, ignored) {
  const set = ignored instanceof Set ? ignored : new Set(ignored || []);
  if (!report || !report.bots || set.size === 0) return report;
  const next = { ...report, bots: {} };
  for (const [bot, data] of Object.entries(report.bots)) {
    const pillars = data.pillars || [];
    const items = data.requirementItems || [];
    const totalWeight = pillars.reduce((n, p) => n + p.weight, 0) || 100;
    const earned = pillars.reduce((n, p) => n + p.score * p.weight, 0) / totalWeight;
    const scoreOf = Object.fromEntries(pillars.map((p) => [p.id, p.score]));
    const weightOf = Object.fromEntries(pillars.map((p) => [p.id, p.weight]));
    const countPerPillar = items.reduce((m, it) => ((m[it.pillar] = (m[it.pillar] || 0) + 1), m), {});
    let dismissedShare = 0;
    for (const it of items) {
      if (!set.has(it.key)) continue;
      const shortfall = ((100 - (scoreOf[it.pillar] ?? 100)) * (weightOf[it.pillar] || 0)) / totalWeight;
      dismissedShare += shortfall / (countPerPillar[it.pillar] || 1);
    }
    const adjustedMax = Math.max(1, 100 - dismissedShare);
    const cap = Number.isFinite(data.cap) ? data.cap : 100;
    const score = Math.min(Math.round(Math.min(100, (earned / adjustedMax) * 100)), cap);
    // requirementItems are kept whole — dismissed ones render greyed with an Undo.
    next.bots[bot] = { ...data, score, level: levelFor(score) };
  }
  const scores = Object.values(next.bots).map((b) => b.score);
  if (scores.length) {
    next.readinessScore = Math.min(...scores);
    next.readinessLevel = levelFor(next.readinessScore);
  }
  next.ignoredRequirements = [...set];
  return next;
}
