process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-sheets';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-sheets';
process.env.GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || 'test-google-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'test-google-secret';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { encrypt } = require('../../src/utils/encryption');

const sheetsSync = require('../../src/services/sheetsSync');
const { getStatus, saveSettings, syncEvent, eventToRow, normalizeSpreadsheetId, SheetsSyncError } = sheetsSync;

const TENANT = { id: 't-sheets' };
const HOUR = 3600 * 1000;

// A stateful stub of the single TenantSheetSync row.
function makePrisma(initial = null) {
  let row = initial;
  const calls = { updates: [] };
  return {
    calls,
    get row() { return row; },
    tenantSheetSync: {
      findUnique: async () => row,
      update: async ({ data }) => { row = { ...row, ...data }; calls.updates.push(data); return row; },
      upsert: async ({ create, update }) => { row = row ? { ...row, ...update } : { tenantId: TENANT.id, ...create }; return row; }
    }
  };
}

// A connected row with a fresh (encrypted) access token so accessTokenFor returns
// it without hitting the network.
const connectedRow = (over = {}) => ({
  tenantId: TENANT.id,
  refreshToken: encrypt('refresh'),
  accessToken: encrypt('access'),
  tokenExpiry: new Date(Date.now() + HOUR),
  spreadsheetId: 'SHEET123',
  spreadsheetName: 'Leads',
  events: ['lead.created'],
  enabled: true,
  ...over
});

describe('sheetsSync: normalizeSpreadsheetId', () => {
  test('extracts the id from a full URL or accepts a bare id', () => {
    assert.equal(normalizeSpreadsheetId('https://docs.google.com/spreadsheets/d/ABC-123_x/edit#gid=0'), 'ABC-123_x');
    assert.equal(normalizeSpreadsheetId('ABC-123_x'), 'ABC-123_x');
    assert.throws(() => normalizeSpreadsheetId('has spaces!'), SheetsSyncError);
  });
});

describe('sheetsSync: eventToRow', () => {
  test('maps an event envelope into stable columns', () => {
    const row = eventToRow({ createdAt: '2026-01-01T00:00:00.000Z', event: 'lead.created', data: { email: 'a@b.com', summary: 'wants a demo', sessionId: 's1', botType: 'sales' } });
    assert.deepEqual(row, ['2026-01-01T00:00:00.000Z', 'lead.created', 'a@b.com', '', 'wants a demo', 's1', 'sales']);
  });
});

describe('sheetsSync: saveSettings', () => {
  test('stores the spreadsheet + events', async () => {
    const prisma = makePrisma(connectedRow({ enabled: false }));
    const s = await saveSettings(TENANT, { spreadsheetId: 'https://docs.google.com/spreadsheets/d/NEWID/edit', events: ['lead.created', 'ticket.created'] }, { prisma });
    assert.equal(s.spreadsheetId, 'NEWID');
    assert.deepEqual(s.events, ['lead.created', 'ticket.created']);
  });
  test('refuses to enable without a connection', async () => {
    const prisma = makePrisma(null);
    await assert.rejects(() => saveSettings(TENANT, { enabled: true }, { prisma }), SheetsSyncError);
  });
  test('refuses to enable without a spreadsheet', async () => {
    const prisma = makePrisma({ tenantId: TENANT.id, refreshToken: encrypt('r'), spreadsheetId: null });
    await assert.rejects(() => saveSettings(TENANT, { enabled: true }, { prisma }), SheetsSyncError);
  });
});

describe('sheetsSync: syncEvent', () => {
  const envelope = (over = {}) => ({ id: 'e1', event: 'lead.created', tenantId: TENANT.id, createdAt: new Date().toISOString(), data: { email: 'a@b.com' }, ...over });

  test('appends a row when connected, enabled and subscribed', async () => {
    const prisma = makePrisma(connectedRow());
    let appended = null;
    const googleSheetsStub = { appendRow: async (args) => { appended = args; return { appended: true }; }, isTokenFresh: () => true };
    const res = await syncEvent(TENANT.id, envelope(), { prisma, googleSheets: googleSheetsStub });
    assert.deepEqual(res, { appended: true });
    assert.equal(appended.spreadsheetId, 'SHEET123');
    assert.equal(appended.values[2], 'a@b.com');
    assert.equal(prisma.row.lastStatus, 'success');
  });

  test('no-op when sync is disabled', async () => {
    const prisma = makePrisma(connectedRow({ enabled: false }));
    const res = await syncEvent(TENANT.id, envelope(), { prisma, googleSheets: { appendRow: async () => { throw new Error('should not be called'); } } });
    assert.deepEqual(res, { skipped: 'not-enabled' });
  });

  test('no-op when the event is not subscribed', async () => {
    const prisma = makePrisma(connectedRow({ events: ['ticket.created'] }));
    const res = await syncEvent(TENANT.id, envelope({ event: 'lead.created' }), { prisma, googleSheets: { appendRow: async () => ({ appended: true }) } });
    assert.deepEqual(res, { skipped: 'event-not-subscribed' });
  });

  test('never throws on an append failure; records the failure', async () => {
    const prisma = makePrisma(connectedRow());
    const googleSheetsStub = { appendRow: async () => { const e = new Error('Sheets 500'); e.statusCode = 502; throw e; }, isTokenFresh: () => true };
    const res = await syncEvent(TENANT.id, envelope(), { prisma, googleSheets: googleSheetsStub });
    assert.equal(res.appended, false);
    assert.match(prisma.row.lastStatus, /^failed:/);
  });
});
