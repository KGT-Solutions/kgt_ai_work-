const defaultPrisma = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { encrypt, decrypt, encryptionConfigured } = require('../utils/encryption');
const { signToken, verifyToken } = require('../utils/authTokens');
const googleSheets = require('./googleSheets');
const { EVENTS, isEvent } = require('./integrationEvents');

// Google Sheets sync (Feature 8) — storage + orchestration over the protocol
// layer (services/googleSheets.js). Owns the one TenantSheetSync row per tenant:
// the Google OAuth connection (tokens encrypted at rest, like SMTP passwords and
// email OAuth, and NEVER returned to the client), the chosen spreadsheet, and
// which events append a row. Mirrors services/emailConnection.js for the OAuth
// half and services/crm/zohoSync.js for the resilient, fire-and-forget sync half:
// a down or unconfigured Sheets connection NEVER delays or breaks a chat reply,
// a lead capture or a ticket.

const MAX_ID_LEN = 200;
const MAX_NAME_LEN = 120;
const MAX_CELL_LEN = 2000;
const DEFAULT_EVENTS = ['lead.created'];
// A spreadsheet id can be pasted as a full URL; pull the id out of it.
const SHEET_ID_IN_URL = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

class SheetsSyncError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SheetsSyncError';
    this.statusCode = statusCode;
  }
}

function safeDecrypt(value) {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

function normalizeSpreadsheetId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const m = SHEET_ID_IN_URL.exec(value);
  const id = (m ? m[1] : value).slice(0, MAX_ID_LEN);
  if (!/^[a-zA-Z0-9-_]+$/.test(id)) throw new SheetsSyncError('That does not look like a valid Google Sheet ID or link.');
  return id;
}

function normalizeEvents(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [...new Set(list.map((e) => String(e || '').trim()).filter(Boolean))];
  const unknown = cleaned.filter((e) => !isEvent(e));
  if (unknown.length) throw new SheetsSyncError(`Unknown event(s): ${unknown.join(', ')}. Choose from: ${EVENTS.join(', ')}`);
  return cleaned.length ? cleaned : DEFAULT_EVENTS;
}

/** Dashboard view. Never returns tokens. */
function toView(row) {
  return {
    configured: googleSheets.sheetsConfigured(),
    connected: !!(row && row.refreshToken),
    email: row?.connectedEmail || null,
    connectedAt: row?.connectedAt || null,
    connectedBy: row?.connectedBy || null,
    spreadsheetId: row?.spreadsheetId || null,
    spreadsheetName: row?.spreadsheetName || null,
    events: row?.events?.length ? row.events : DEFAULT_EVENTS,
    enabled: row?.enabled === true,
    lastStatus: row?.lastStatus || null,
    lastSyncAt: row?.lastSyncAt || null,
    availableEvents: EVENTS
  };
}

async function getStatus(tenant, { prisma = defaultPrisma } = {}) {
  const row = await prisma.tenantSheetSync.findUnique({ where: { tenantId: tenant.id } }).catch(() => null);
  return toView(row);
}

/** Start the OAuth flow: hand back the Google consent URL. */
async function beginConnect({ tenantId, redirectUri, actor = null }) {
  if (!encryptionConfigured()) throw new SheetsSyncError('Secure storage is not configured on the server (ENCRYPTION_KEY is unset).', 503);
  if (!googleSheets.sheetsConfigured()) throw new SheetsSyncError('Google Sheets is not configured on this server yet.', 503);
  const state = signToken('sheets_oauth', { tenantId, actor });
  return { authUrl: googleSheets.authorizeUrl({ state, redirectUri }) };
}

/** Finish the OAuth flow from the public callback: verify state, exchange the code, store encrypted tokens. */
async function completeConnect({ state, code, redirectUri }, { prisma = defaultPrisma, fetchImpl = fetch } = {}) {
  const claims = verifyToken(state, 'sheets_oauth');
  if (!claims?.tenantId) throw new SheetsSyncError('The connection link expired or is invalid. Start again from the dashboard.', 400);
  const tokens = await googleSheets.exchangeCode({ code, redirectUri, fetchImpl });
  const conn = {
    connectedEmail: tokens.email,
    refreshToken: encrypt(tokens.refreshToken),
    accessToken: encrypt(tokens.accessToken),
    tokenExpiry: tokens.tokenExpiry,
    scope: tokens.scope,
    connectedAt: new Date(),
    connectedBy: claims.actor || null
  };
  await prisma.tenantSheetSync.upsert({
    where: { tenantId: claims.tenantId },
    update: conn,
    create: { tenantId: claims.tenantId, events: DEFAULT_EVENTS, ...conn }
  });
  return { tenantId: claims.tenantId, email: tokens.email };
}

/** Remove the connection + its config (keep the row). Idempotent. */
async function disconnect(tenant, { prisma = defaultPrisma } = {}) {
  const existing = await prisma.tenantSheetSync.findUnique({ where: { tenantId: tenant.id } }).catch(() => null);
  if (existing) {
    await prisma.tenantSheetSync.update({
      where: { tenantId: tenant.id },
      data: { refreshToken: null, accessToken: null, tokenExpiry: null, scope: null, connectedEmail: null, connectedAt: null, connectedBy: null, enabled: false }
    });
  }
  return getStatus(tenant, { prisma });
}

/** Choose the spreadsheet, which events to sync, and whether sync is on. */
async function saveSettings(tenant, patch = {}, { prisma = defaultPrisma } = {}) {
  const existing = await prisma.tenantSheetSync.findUnique({ where: { tenantId: tenant.id } }).catch(() => null);
  const data = {};
  if (patch.spreadsheetId !== undefined) data.spreadsheetId = normalizeSpreadsheetId(patch.spreadsheetId) || null;
  if (patch.spreadsheetName !== undefined) data.spreadsheetName = String(patch.spreadsheetName || '').slice(0, MAX_NAME_LEN) || null;
  if (patch.events !== undefined) data.events = normalizeEvents(patch.events);
  if (patch.enabled !== undefined) data.enabled = !!patch.enabled;
  // Turning sync on needs both a connection and a spreadsheet.
  const willEnable = data.enabled ?? existing?.enabled ?? false;
  const spreadsheetId = data.spreadsheetId ?? existing?.spreadsheetId ?? null;
  if (willEnable) {
    if (!existing?.refreshToken) throw new SheetsSyncError('Connect your Google account before turning sync on.');
    if (!spreadsheetId) throw new SheetsSyncError('Choose a spreadsheet before turning sync on.');
  }
  if (!Object.keys(data).length) throw new SheetsSyncError('Nothing to update.');
  await prisma.tenantSheetSync.upsert({
    where: { tenantId: tenant.id },
    update: data,
    create: { tenantId: tenant.id, events: DEFAULT_EVENTS, ...data }
  });
  return getStatus(tenant, { prisma });
}

// A valid access token for the stored connection, refreshing + persisting when
// the cached one is missing/stale. Mirrors emailConnection.accessTokenFor.
async function accessTokenFor(row, { prisma, fetchImpl, now, force = false }) {
  if (!force && googleSheets.isTokenFresh(row.tokenExpiry, now) && row.accessToken) {
    const cached = safeDecrypt(row.accessToken);
    if (cached) return cached;
  }
  const refreshToken = safeDecrypt(row.refreshToken);
  if (!refreshToken) throw new SheetsSyncError('could not read the stored Google token (ENCRYPTION_KEY changed?)', 400);
  const fresh = await googleSheets.refreshAccessToken({ refreshToken, fetchImpl, now });
  try {
    await prisma.tenantSheetSync.update({
      where: { tenantId: row.tenantId },
      data: { accessToken: encrypt(fresh.accessToken), tokenExpiry: fresh.tokenExpiry, ...(fresh.refreshToken ? { refreshToken: encrypt(fresh.refreshToken) } : {}) }
    });
  } catch (err) {
    logger.warn(`[sheets] could not persist refreshed token for tenant ${row.tenantId}: ${err.message}`);
  }
  return fresh.accessToken;
}

// One event envelope → a consistent spreadsheet row. The columns are stable
// across event types so a sheet stays readable: Timestamp, Event, Email,
// Name/Kind, Summary/Query, Session, Bot.
function eventToRow(envelope) {
  const d = envelope.data || {};
  const cell = (v) => String(v == null ? '' : v).slice(0, MAX_CELL_LEN);
  return [
    cell(envelope.createdAt),
    cell(envelope.event),
    cell(d.email || d.contactEmail || ''),
    cell(d.name || d.kind || ''),
    cell(d.summary || d.query || ''),
    cell(d.sessionId || ''),
    cell(d.botType || '')
  ];
}

const safeError = (err) => String(err?.message || err).slice(0, 200);

/**
 * Append a row for one event to the tenant's sheet. Called by
 * integrationEvents.emitTenantEvent — fire-and-forget. Never throws. No-op unless
 * connected, enabled, a spreadsheet is set, and the event is subscribed.
 */
async function syncEvent(tenantId, envelope, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const fetchImpl = deps.fetchImpl || fetch;
  const now = deps.now || Date.now();
  const sheets = deps.googleSheets || googleSheets;
  if (!encryptionConfigured()) return { skipped: 'unconfigured' };

  let row;
  try {
    row = await prisma.tenantSheetSync.findUnique({ where: { tenantId } });
  } catch (err) {
    logger.warn(`[sheets] could not load sync for tenant ${tenantId}: ${err.message}`);
    return { skipped: 'lookup-failed' };
  }
  if (!row || !row.enabled || !row.refreshToken || !row.spreadsheetId) return { skipped: 'not-enabled' };
  if (!(row.events || []).includes(envelope.event)) return { skipped: 'event-not-subscribed' };

  const values = eventToRow(envelope);
  try {
    let accessToken = await accessTokenFor(row, { prisma, fetchImpl, now });
    try {
      await sheets.appendRow({ accessToken, spreadsheetId: row.spreadsheetId, sheetName: row.spreadsheetName, values }, { fetchImpl });
    } catch (err) {
      if (err?.statusCode !== 401) throw err;
      // Stored token looked fresh but Google rejected it — mint a new one and retry once.
      accessToken = await accessTokenFor(row, { prisma, fetchImpl, now, force: true });
      await sheets.appendRow({ accessToken, spreadsheetId: row.spreadsheetId, sheetName: row.spreadsheetName, values }, { fetchImpl });
    }
    await prisma.tenantSheetSync.update({ where: { tenantId }, data: { lastStatus: 'success', lastSyncAt: new Date(now) } })
      .catch(() => {});
    return { appended: true };
  } catch (err) {
    logger.error(`[sheets] ERROR: ${envelope.event} append FAILED (tenant ${tenantId}): ${err.message}`);
    await prisma.tenantSheetSync.update({ where: { tenantId }, data: { lastStatus: `failed: ${safeError(err)}`, lastSyncAt: new Date(now) } })
      .catch(() => {});
    return { appended: false, error: safeError(err) };
  }
}

module.exports = {
  SheetsSyncError,
  getStatus,
  beginConnect,
  completeConnect,
  disconnect,
  saveSettings,
  syncEvent,
  eventToRow,
  normalizeSpreadsheetId,
  normalizeEvents,
  DEFAULT_EVENTS
};
