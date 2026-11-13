const express = require('express');
const { completeConnect } = require('../services/crm/crmSettings');

// Public CRM OAuth callback. Zoho redirects the tenant's browser here after
// they grant (or decline) consent:
//
//   GET /api/v1/public/crm/zoho/callback?code=...&state=...
//
// It isn't authenticated by a dashboard token — the signed `state` is what
// binds the flow to a tenant (services/crm/crmSettings.js). On success the
// tokens are exchanged and stored, then the browser is sent back to the
// dashboard Integrations page with a result flag. It never throws an HTML
// 500 at the user: any failure becomes a tidy redirect with ?crm=error.
const router = express.Router();

/**
 * Where Zoho sends the code back. Must match a redirect URI registered on the
 * Zoho OAuth app, and be identical for the authorize step and this exchange —
 * so it's pinned by ZOHO_REDIRECT_URI, falling back to this request's own host.
 */
function redirectUri(req) {
  const fromEnv = String(process.env.ZOHO_REDIRECT_URI || '').trim();
  if (fromEnv) return fromEnv;
  return `${req.protocol}://${req.get('host')}/api/v1/public/crm/zoho/callback`;
}

function dashboardReturn(result, reason) {
  const base = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({ crm: result, ...(reason ? { reason } : {}) }).toString();
  return base ? `${base}/dashboard/integrations?${qs}` : null;
}

router.get('/zoho/callback', async (req, res) => {
  const back = (result, reason) => {
    const url = dashboardReturn(result, reason);
    if (url) return res.redirect(url);
    // No dashboard URL configured (e.g. local API-only testing): answer in JSON.
    return res.status(result === 'connected' ? 200 : 400).json({ crm: result, reason });
  };

  // The user declined consent, or Zoho returned an error instead of a code.
  if (req.query.error) return back('error', String(req.query.error).slice(0, 80));
  const { code, state } = req.query;
  if (!code || !state) return back('error', 'missing_code');

  try {
    const { tenantId } = await completeConnect({ code: String(code), state: String(state), redirectUri: redirectUri(req) });
    console.log(`[crm] Zoho connected for tenant ${tenantId}`);
    return back('connected');
  } catch (err) {
    console.error(`[crm] ERROR: Zoho OAuth callback failed: ${err.message}`);
    return back('error', err.statusCode === 400 ? 'expired' : 'exchange_failed');
  }
});

module.exports = router;
module.exports.redirectUri = redirectUri;
