const express = require('express');
const { logger } = require('../lib/logger');
const { completeConnect, SheetsSyncError } = require('../services/sheetsSync');

// Public Google Sheets OAuth callback (Feature 8). Google redirects the tenant's
// browser here after they grant (or decline) spreadsheets consent:
//
//   GET /api/v1/public/sheets/callback?code=...&state=...
//
// Not authenticated by a dashboard token — the signed `state` binds the flow to a
// tenant (services/sheetsSync.js). On success the tokens are exchanged and stored
// (encrypted), then the browser is sent back to the dashboard Integrations page
// with a result flag. Any failure becomes a tidy redirect with ?sheets=error,
// never an HTML 500. Mirrors routes/emailOAuth.routes.js.
const router = express.Router();

/** Where Google sends the code back. Pinned by env, falling back to this request's host. */
function redirectUri(req) {
  const fromEnv = String(process.env.GOOGLE_SHEETS_OAUTH_REDIRECT_URI || '').trim();
  if (fromEnv) return fromEnv;
  return `${req.protocol}://${req.get('host')}/api/v1/public/sheets/callback`;
}

function dashboardReturn(result, reason) {
  const base = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({ sheets: result, ...(reason ? { reason } : {}) }).toString();
  return base ? `${base}/dashboard/integrations?${qs}` : null;
}

router.get('/callback', async (req, res) => {
  const back = (result, reason) => {
    const url = dashboardReturn(result, reason);
    if (url) return res.redirect(url);
    return res.status(result === 'connected' ? 200 : 400).json({ sheets: result, reason });
  };

  if (req.query.error) return back('error', String(req.query.error).slice(0, 80));
  const { code, state } = req.query;
  if (!code || !state) return back('error', 'missing_code');

  try {
    const { tenantId } = await completeConnect({ code: String(code), state: String(state), redirectUri: redirectUri(req) });
    logger.info(`[sheets] Google Sheets connected for tenant ${tenantId}`);
    return back('connected');
  } catch (err) {
    logger.error(`[sheets] ERROR: Sheets OAuth callback failed: ${err.message}`);
    const reason = err instanceof SheetsSyncError && err.statusCode === 400 ? 'expired' : 'exchange_failed';
    return back('error', reason);
  }
});

module.exports = router;
module.exports.redirectUri = redirectUri;
