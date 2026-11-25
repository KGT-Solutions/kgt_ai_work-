const defaultPrisma = require('../lib/prisma');

// Human Escalation (Feature 5): per-tenant control of WHEN a chat hands off to a
// person and WHAT reply ETA the visitor is told to expect.
//
//   Trigger keywords  extra phrases that route a message to the existing handoff
//                     path (domains/handoffActions.js) on top of the built-in
//                     "talk to a human" detection. They never change an answer —
//                     only whether this turn becomes a handoff — so the grounded
//                     chat and sandbox isolation are untouched.
//   Business hours    a timezone + per-weekday open ranges, used to compute a
//                     clear reply ETA sentence appended to a handoff reply and
//                     stored on the ticket, different inside vs. outside hours.
//
// One TenantEscalationSettings row per tenant; absent = platform defaults (no
// extra triggers, no ETA promised — matching the stock "never promise a time"
// handoff copy). Everything here is defensive: a bad config or a DB blip must
// never break a chat turn, so the chat-path helpers never throw.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_KEYWORDS = 40;
const MAX_KEYWORD_LEN = 60;
const MAX_ETA_MINUTES = 60 * 24 * 7; // a week — beyond that an "ETA" is meaningless
const MAX_OFFHOURS_TEXT = 300;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

class EscalationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'EscalationError';
    this.statusCode = statusCode;
  }
}

// ── Validation ────────────────────────────────────────────────────────────

/** Lower-cased, trimmed, de-duplicated, bounded. Non-strings and blanks drop out. */
function normalizeKeywords(raw) {
  if (raw === undefined || raw === null) return undefined; // "not provided" — leave as-is
  if (!Array.isArray(raw)) throw new EscalationError('triggerKeywords must be a list of phrases');
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const k = String(item ?? '').trim().toLowerCase().slice(0, MAX_KEYWORD_LEN);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** A valid IANA timezone, or null. Rejects anything Intl can't resolve. */
function normalizeTimezone(raw) {
  if (raw === undefined) return undefined;
  const tz = String(raw ?? '').trim();
  if (!tz) return null;
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new EscalationError(`"${tz}" is not a recognised timezone`);
  }
}

/**
 * Validate a business-hours object: { mon: [["09:00","17:00"], ...], ... }.
 * Days default to closed (absent / empty array). Ranges must be well-formed
 * "HH:MM" with start before end. Returns a clean, day-keyed object.
 */
function normalizeBusinessHours(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new EscalationError('businessHours must be an object keyed by weekday');
  const out = {};
  for (const [day, ranges] of Object.entries(raw)) {
    const key = String(day).trim().toLowerCase();
    if (!DAY_KEYS.includes(key)) throw new EscalationError(`"${day}" is not a weekday (use mon, tue, …, sun)`);
    if (ranges === null || ranges === undefined) continue;
    if (!Array.isArray(ranges)) throw new EscalationError(`Hours for ${key} must be a list of [open, close] ranges`);
    const clean = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2) throw new EscalationError(`Each range for ${key} must be [open, close]`);
      const [start, end] = range.map((v) => String(v ?? '').trim());
      if (!HHMM.test(start) || !HHMM.test(end)) throw new EscalationError(`Times for ${key} must be "HH:MM" (24-hour)`);
      if (toMinutes(start) >= toMinutes(end)) throw new EscalationError(`For ${key}, the open time must be before the close time`);
      clean.push([start, end]);
    }
    if (clean.length) out[key] = clean;
  }
  return out;
}

function parseEscalationInput(body = {}) {
  const data = {};
  const keywords = normalizeKeywords(body.triggerKeywords);
  if (keywords !== undefined) data.triggerKeywords = keywords;
  if (body.keywordsEnabled !== undefined) data.keywordsEnabled = !!body.keywordsEnabled;
  const tz = normalizeTimezone(body.businessTimezone);
  if (tz !== undefined) data.businessTimezone = tz;
  const hours = normalizeBusinessHours(body.businessHours);
  if (hours !== undefined) data.businessHours = hours;
  if (body.replyEtaMinutes !== undefined) {
    if (body.replyEtaMinutes === null || body.replyEtaMinutes === '') {
      data.replyEtaMinutes = null;
    } else {
      const n = Number(body.replyEtaMinutes);
      if (!Number.isInteger(n) || n <= 0 || n > MAX_ETA_MINUTES) {
        throw new EscalationError(`replyEtaMinutes must be a whole number of minutes between 1 and ${MAX_ETA_MINUTES}`);
      }
      data.replyEtaMinutes = n;
    }
  }
  if (body.offHoursEtaText !== undefined) {
    const t = String(body.offHoursEtaText ?? '').trim().slice(0, MAX_OFFHOURS_TEXT);
    data.offHoursEtaText = t || null;
  }
  return data;
}

// ── Business-hours maths ────────────────────────────────────────────────────

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** The weekday key + minutes-since-midnight for `now` in the given timezone. */
function zonedNow(now, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const day = String(parts.weekday || '').slice(0, 3).toLowerCase(); // "Mon" -> "mon"
  // hour12:false yields "24" at midnight in some ICU builds — fold it to 0.
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { day, minutes: hour * 60 + minute };
}

/** Whether any configured range covers `now`. */
function isWithinBusinessHours(settings, now = new Date()) {
  const hours = settings?.businessHours;
  if (!hours || typeof hours !== 'object') return false;
  const { day, minutes } = zonedNow(now, settings.businessTimezone);
  const ranges = hours[day];
  if (!Array.isArray(ranges)) return false;
  return ranges.some(([start, end]) => minutes >= toMinutes(start) && minutes < toMinutes(end));
}

/** True once at least one open range is configured on any day. */
function hasBusinessHours(settings) {
  const hours = settings?.businessHours;
  if (!hours || typeof hours !== 'object') return false;
  return DAY_KEYS.some((d) => Array.isArray(hours[d]) && hours[d].length);
}

/**
 * The reply ETA for a handoff raised now.
 * @returns {{ configured: boolean, withinHours: boolean, etaMinutes: number|null, text: string }}
 *   configured false = no business hours set, so callers promise nothing.
 */
function computeReplyEta(settings, { now = new Date(), lang = 'en' } = {}) {
  if (!settings || !hasBusinessHours(settings)) {
    return { configured: false, withinHours: false, etaMinutes: null, text: '' };
  }
  const withinHours = isWithinBusinessHours(settings, now);
  const etaMinutes = withinHours ? (settings.replyEtaMinutes || null) : null;
  return { configured: true, withinHours, etaMinutes, text: etaSentence({ settings, withinHours, lang }) };
}

const hi = (lang) => String(lang || '').toLowerCase().startsWith('hi');

/** "30 minutes" / "2 hours" / "1 hour 30 minutes", localized. */
function humanizeMinutes(total, lang) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (hi(lang)) {
    const parts = [];
    if (h) parts.push(`${h} घंटे`);
    if (m) parts.push(`${m} मिनट`);
    return parts.join(' ') || `${total} मिनट`;
  }
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' ') || `${total} minutes`;
}

/** The sentence appended to a handoff reply (and stored on the ticket). May be ''. */
function etaSentence({ settings, withinHours, lang = 'en' }) {
  if (withinHours) {
    const mins = settings?.replyEtaMinutes;
    if (mins) {
      return hi(lang)
        ? `हमारी टीम अभी उपलब्ध है और आम तौर पर लगभग ${humanizeMinutes(mins, lang)} में जवाब देती है।`
        : `Our team is available now and usually replies within about ${humanizeMinutes(mins, lang)}.`;
    }
    return hi(lang)
      ? 'हमारी टीम अभी उपलब्ध है और जल्द से जल्द आपसे संपर्क करेगी।'
      : 'Our team is available now and will get back to you as soon as they can.';
  }
  const custom = String(settings?.offHoursEtaText || '').trim();
  if (custom) return custom;
  return hi(lang)
    ? 'हमारी टीम अभी कार्य-समय के बाहर है, लेकिन दोबारा उपलब्ध होते ही वे आपसे संपर्क करेंगे।'
    : "Our team is outside business hours right now, but they'll get back to you as soon as they're back.";
}

// ── Trigger-keyword matching ────────────────────────────────────────────────

/**
 * The first configured trigger keyword the message contains (case-insensitive,
 * whole-word), or null. Narrow by design: a keyword only matters as a whole
 * word, so "agentic" doesn't match the keyword "agent".
 */
function matchTriggerKeyword(query, keywords) {
  if (!Array.isArray(keywords) || !keywords.length) return null;
  const text = ` ${String(query || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  for (const kw of keywords) {
    const needle = ` ${String(kw).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
    if (needle.trim() && text.includes(needle)) return kw;
  }
  return null;
}

// ── Persistence ─────────────────────────────────────────────────────────────

function toView(row) {
  return {
    triggerKeywords: row?.triggerKeywords || [],
    keywordsEnabled: row?.keywordsEnabled !== false,
    businessTimezone: row?.businessTimezone || null,
    businessHours: row?.businessHours || {},
    replyEtaMinutes: row?.replyEtaMinutes ?? null,
    offHoursEtaText: row?.offHoursEtaText || null
  };
}

async function getEscalationSettings(tenantId, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantEscalationSettings.findUnique({ where: { tenantId } }).catch(() => null);
  return toView(row);
}

async function updateEscalationSettings(tenantId, body, { prisma = defaultPrisma } = {}) {
  const data = parseEscalationInput(body);
  const row = await prisma.tenantEscalationSettings.upsert({
    where: { tenantId },
    update: data,
    create: { tenantId, ...data }
  });
  return toView(row);
}

/**
 * The escalation context for one chat turn: the enabled trigger keywords and the
 * reply-ETA sentence to append to a handoff, precomputed in the turn's language.
 * Never throws — chat falls back to no triggers and no ETA on any failure.
 * @returns {Promise<{ keywordsEnabled: boolean, keywords: string[], etaSentence: string }>}
 */
async function escalationContextFor(tenantId, { lang = 'en', now = new Date(), prisma = defaultPrisma } = {}) {
  try {
    const row = await prisma.tenantEscalationSettings.findUnique({ where: { tenantId } });
    if (!row) return { keywordsEnabled: false, keywords: [], etaSentence: '' };
    const eta = computeReplyEta(row, { now, lang });
    return {
      keywordsEnabled: row.keywordsEnabled !== false,
      keywords: row.keywordsEnabled !== false ? (row.triggerKeywords || []) : [],
      etaSentence: eta.text
    };
  } catch {
    return { keywordsEnabled: false, keywords: [], etaSentence: '' };
  }
}

module.exports = {
  EscalationError,
  DAY_KEYS,
  parseEscalationInput,
  normalizeKeywords,
  normalizeTimezone,
  normalizeBusinessHours,
  isWithinBusinessHours,
  hasBusinessHours,
  computeReplyEta,
  etaSentence,
  matchTriggerKeyword,
  getEscalationSettings,
  updateEscalationSettings,
  escalationContextFor,
  toView
};
