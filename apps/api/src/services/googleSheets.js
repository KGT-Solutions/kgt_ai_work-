const emailOAuth = require('./emailOAuth');

// Google Sheets protocol layer (Feature 8). Pure, env-gated and
// network-injectable (fetchImpl): no database here — services/sheetsSync.js owns
// storage. It reuses the SAME Google OAuth app as the email connection
// (GOOGLE_OAUTH_CLIENT_ID/SECRET) and the SAME scope-agnostic token exchange /
// refresh helpers in services/emailOAuth.js; only the requested scope and the
// resource API differ:
//   • scope  https://www.googleapis.com/auth/spreadsheets (+ openid email to
//            learn the connected account) — append-only use, nothing else.
//   • append POST .../values/{range}:append on the tenant's chosen spreadsheet.
// When the Google OAuth app isn't configured, this simply reports itself
// unconfigured and the UI disables the button — nothing throws on load.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TIMEOUT_MS = 15000;

const readKey = (name) => String(process.env[name] || '').trim();

class GoogleSheetsError extends Error {
  constructor(message, statusCode = 502, { retryable = false } = {}) {
    super(message);
    this.name = 'GoogleSheetsError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

function sheetsScope() {
  return readKey('GOOGLE_SHEETS_OAUTH_SCOPE') || 'https://www.googleapis.com/auth/spreadsheets openid email';
}

/** Whether the shared Google OAuth app credentials are configured on this server. */
function sheetsConfigured() {
  return emailOAuth.providerConfigured('google');
}

/**
 * The Google consent URL for Sheets access. `state` is our signed token binding
 * the callback to a tenant; `redirectUri` must match one registered on the app.
 */
function authorizeUrl({ state, redirectUri }) {
  const clientId = readKey('GOOGLE_OAUTH_CLIENT_ID');
  if (!clientId) throw new GoogleSheetsError('Google Sheets is not configured on this server', 503);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: sheetsScope(),
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// Token exchange / refresh reuse the scope-agnostic helpers in emailOAuth (same
// Google app, same token endpoint). exchangeCode requires a refresh token — a
// connection without one is unusable — exactly as the email flow does.
function exchangeCode({ code, redirectUri, fetchImpl = fetch, now = Date.now() }) {
  return emailOAuth.exchangeCode('google', { code, redirectUri, fetchImpl, now });
}
function refreshAccessToken({ refreshToken, fetchImpl = fetch, now = Date.now() }) {
  return emailOAuth.refreshAccessToken('google', { refreshToken, fetchImpl, now });
}
const isTokenFresh = emailOAuth.isTokenFresh;

// A1 range for appending to a named sheet/tab (quote the name so spaces and
// punctuation are safe). Google appends after the last row of the table found
// at the range, so "<sheet>!A1" appends to the first table on that sheet.
function appendRange(sheetName) {
  const name = String(sheetName || 'Sheet1').trim() || 'Sheet1';
  return `${name.replace(/'/g, "''")}!A1`;
}

/**
 * Append one row of values to the given spreadsheet/sheet. Values are coerced to
 * strings by the caller. Throws GoogleSheetsError (retryable flagged) on failure.
 */
async function appendRow({ accessToken, spreadsheetId, sheetName, values }, { fetchImpl = fetch } = {}) {
  if (!accessToken) throw new GoogleSheetsError('no access token', 401);
  if (!spreadsheetId) throw new GoogleSheetsError('no spreadsheet selected', 400);
  const range = encodeURIComponent(appendRange(sheetName));
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [values.map((v) => (v == null ? '' : String(v)))] }),
      signal: controller.signal
    });
    if (res.ok) return { appended: true };
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    // 401 = token rejected (mint a new one); 404 = bad spreadsheet id / no access; 429/5xx = transient.
    const statusCode = res.status === 401 ? 401 : res.status === 404 ? 404 : 502;
    throw new GoogleSheetsError(`Sheets append failed (${res.status}) ${detail}`.trim(), statusCode, { retryable: res.status >= 500 || res.status === 429 });
  } catch (err) {
    if (err instanceof GoogleSheetsError) throw err;
    throw new GoogleSheetsError(`Sheets append request failed: ${err.message}`, 502, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  GoogleSheetsError,
  sheetsScope,
  sheetsConfigured,
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  isTokenFresh,
  appendRow,
  appendRange
};
