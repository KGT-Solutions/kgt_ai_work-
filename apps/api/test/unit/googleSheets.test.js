process.env.GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || 'test-google-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'test-google-secret';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const googleSheets = require('../../src/services/googleSheets');
const { authorizeUrl, appendRow, appendRange, sheetsConfigured, GoogleSheetsError } = googleSheets;

describe('googleSheets: config + authorizeUrl', () => {
  test('reports configured when the Google OAuth app creds are set', () => {
    assert.equal(sheetsConfigured(), true);
  });
  test('authorizeUrl carries the spreadsheets scope and offline access', () => {
    const url = authorizeUrl({ state: 'st8', redirectUri: 'https://app.example.com/cb' });
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.match(parsed.searchParams.get('scope'), /spreadsheets/);
    assert.equal(parsed.searchParams.get('access_type'), 'offline');
    assert.equal(parsed.searchParams.get('prompt'), 'consent');
    assert.equal(parsed.searchParams.get('state'), 'st8');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'https://app.example.com/cb');
  });
});

describe('googleSheets: appendRange', () => {
  test('quotes the tab name and targets A1 (append after the last row)', () => {
    assert.equal(appendRange('Sheet1'), 'Sheet1!A1');
    assert.equal(appendRange("My Leads"), 'My Leads!A1');
    assert.equal(appendRange("O'Brien"), "O''Brien!A1"); // single quote doubled
    assert.equal(appendRange(''), 'Sheet1!A1');
  });
});

describe('googleSheets: appendRow', () => {
  test('POSTs the values to the Sheets append API and returns appended', async () => {
    let captured;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, text: async () => '' }; };
    const res = await appendRow({ accessToken: 'tok', spreadsheetId: 'SID', sheetName: 'Leads', values: ['2026', 'lead.created', 'a@b.com'] }, { fetchImpl });
    assert.deepEqual(res, { appended: true });
    assert.match(captured.url, /\/spreadsheets\/SID\/values\/.*:append/);
    assert.match(captured.url, /valueInputOption=USER_ENTERED/);
    assert.equal(captured.opts.headers.authorization, 'Bearer tok');
    const body = JSON.parse(captured.opts.body);
    assert.deepEqual(body.values, [['2026', 'lead.created', 'a@b.com']]); // one row, all strings
  });

  test('a 401 surfaces as a 401 error (so the caller refreshes the token)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauth' });
    await assert.rejects(() => appendRow({ accessToken: 't', spreadsheetId: 'S', values: ['x'] }, { fetchImpl }),
      (e) => e instanceof GoogleSheetsError && e.statusCode === 401);
  });
  test('a network failure is retryable', async () => {
    const fetchImpl = async () => { throw new Error('ECONNRESET'); };
    await assert.rejects(() => appendRow({ accessToken: 't', spreadsheetId: 'S', values: ['x'] }, { fetchImpl }),
      (e) => e instanceof GoogleSheetsError && e.retryable === true);
  });
  test('refuses to append without a spreadsheet id', async () => {
    await assert.rejects(() => appendRow({ accessToken: 't', values: ['x'] }, { fetchImpl: async () => ({ ok: true }) }),
      (e) => e instanceof GoogleSheetsError && e.statusCode === 400);
  });
});
