const prismaDefault = require('../lib/prisma');
const { logger } = require('../lib/logger');

// Monthly voice-minute metering + caps for Speech-to-Speech (Feature 4).
//
// The cap is a soft usage allowance (a tenant's plan), NOT a security boundary,
// so two deliberate simplifications apply:
//   - Duration is ESTIMATED from the encoded audio size rather than decoded, so
//     there's no media/ffmpeg dependency. Tune the rate with
//     VOICE_AUDIO_BYTES_PER_SEC if your widget records at a different bitrate.
//   - The whole module fails OPEN: a metering read/write error never silences a
//     tenant's voice chat (we'd rather under-count than wrongly block).
//
// Metering is per UTC month so all API instances agree on the boundary and a
// tenant can't reset their allowance by changing timezone. Only LIVE turns are
// metered — the dashboard's own sandbox test never consumes the allowance.

// ~48 kbps webm/opus voice ≈ 6 KB per second. An estimate; see the note above.
const DEFAULT_BYTES_PER_SEC = 6000;
const MAX_MINUTES = 100000; // guardrails input ceiling (≈ 1667 hours/month)

function bytesPerSec() {
  const n = Number(process.env.VOICE_AUDIO_BYTES_PER_SEC);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BYTES_PER_SEC;
}

/**
 * Seconds of speech estimated from the encoded audio byte length. Rounds up to a
 * floor of 1s for any non-empty clip so a very short turn still counts.
 * @param {number} byteLength
 * @returns {number} whole seconds (0 for empty audio)
 */
function estimateSeconds(byteLength) {
  const bytes = Number(byteLength) || 0;
  if (bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / bytesPerSec()));
}

/** The metering period key for a moment in time: 'YYYY-MM' in UTC. */
function currentPeriod(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * This month's cap in SECONDS: the tenant's guardrail minutes when set, else the
 * platform default (env VOICE_MONTHLY_MINUTES_DEFAULT). 0 means unlimited.
 * @param {{ voiceMonthlyMinutes?: number|null }|null} guardrails
 * @returns {number} cap in seconds, or 0 for unlimited
 */
function resolveCapSeconds(guardrails) {
  const perTenant = guardrails ? guardrails.voiceMonthlyMinutes : undefined;
  let minutes;
  if (perTenant === null || perTenant === undefined) {
    const env = Number(process.env.VOICE_MONTHLY_MINUTES_DEFAULT);
    minutes = Number.isFinite(env) && env > 0 ? env : 0;
  } else {
    minutes = Number(perTenant) || 0;
  }
  return minutes > 0 ? minutes * 60 : 0;
}

/** Seconds already used by a tenant in the current period (0 when no row yet). */
async function usedSeconds(tenantId, { prisma = prismaDefault, now = Date.now() } = {}) {
  const row = await prisma.tenantVoiceUsage.findUnique({
    where: { tenantId_period: { tenantId, period: currentPeriod(now) } },
    select: { secondsUsed: true }
  });
  return row?.secondsUsed || 0;
}

/**
 * Whether a voice turn is allowed under this month's cap, with the usage figures
 * for display. Never throws: a metering lookup failure fails OPEN (allowed).
 * @returns {Promise<{ allowed: boolean, capSeconds: number, usedSeconds: number, remainingSeconds: number|null }>}
 *   remainingSeconds is null when unlimited or on a lookup failure.
 */
async function checkVoiceCap({ tenantId, guardrails, prisma = prismaDefault, now = Date.now() }) {
  const capSeconds = resolveCapSeconds(guardrails);
  if (capSeconds <= 0) return { allowed: true, capSeconds: 0, usedSeconds: 0, remainingSeconds: null };
  try {
    const used = await usedSeconds(tenantId, { prisma, now });
    return { allowed: used < capSeconds, capSeconds, usedSeconds: used, remainingSeconds: Math.max(0, capSeconds - used) };
  } catch (err) {
    logger.warn(`[voiceUsage] cap check failed for tenant ${tenantId}: ${err.message}`);
    return { allowed: true, capSeconds, usedSeconds: 0, remainingSeconds: null };
  }
}

/**
 * Add seconds to this month's tally (upsert — the first voice turn of a month
 * creates the row). The caller treats this as best-effort: a metering write must
 * never fail the turn the visitor already got.
 */
async function recordUsage({ tenantId, seconds, prisma = prismaDefault, now = Date.now() }) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s <= 0) return;
  const period = currentPeriod(now);
  await prisma.tenantVoiceUsage.upsert({
    where: { tenantId_period: { tenantId, period } },
    create: { tenantId, period, secondsUsed: s, turns: 1 },
    update: { secondsUsed: { increment: s }, turns: { increment: 1 } }
  });
}

/** The spoken+shown notice when a visitor is over this month's voice allowance. */
function voiceLimitMessage(language) {
  return language === 'hi'
    ? 'इस महीने की वॉइस सीमा पूरी हो चुकी है। कृपया अपना संदेश टेक्स्ट में भेजें।'
    : "You've reached this month's voice limit. Please type your message instead.";
}

module.exports = {
  estimateSeconds, currentPeriod, resolveCapSeconds, usedSeconds,
  checkVoiceCap, recordUsage, voiceLimitMessage, DEFAULT_BYTES_PER_SEC, MAX_MINUTES
};
