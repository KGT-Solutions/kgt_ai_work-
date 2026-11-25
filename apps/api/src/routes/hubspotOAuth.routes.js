const express = require('express');
const { logger } = require('../lib/logger');
const { completeConnect } = require('../services/crm/hubspotSettings');
const { CrmError: HubspotError } = require('../services/crm/hubspotAuth');

// Public HubSpot CRM OAuth callback (Feature 9). HubSpot redirects the tenant's
// browser here after they grant (or decline) consent:
//
//   GET /api/v1/public/hubspot/callback?code=...&state=...
//
// Not authenticated by a dashboard token — the signed `state` binds the flow to a
// tenant (services/crm/hubspotSettings.js). On success the tokens are exchanged
// and stored (encrypted), then the browser is sent back to the dashboard
// Integrations page with a result flag. Any failure becomes a tidy redirect with
// ?hubspot=error, never an HTML 500. Mirrors routes/sheetsOAuth.routes.js.
const router = express.Router();

/** Where HubSpot sends the code back. Pinned by env, falling back to this request's host. */
function redirectUri(req) {
  const fromEnv = String(process.env.HUBSPOT_REDIRECT_URI || '').trim();
  if (fromEnv) return fromEnv;
  return `${req.protocol}://${req.get('host')}/api/v1/public/hubspot/callback`;
}

function dashboardReturn(result, reason) {
  const base = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({ hubspot: result, ...(reason ? { reason } : {}) }).toString();
  return base ? `${base}/dashboard/integrations?${qs}` : null;
}

router.get('/callback', async (req, res) => {
  const back = (result, reason) => {
    const url = dashboardReturn(result, reason);
    if (url) return res.redirect(url);
    return res.status(result === 'connected' ? 200 : 400).json({ hubspot: result, reason });
  };

  if (req.query.error) return back('error', String(req.query.error).slice(0, 80));
  const { code, state } = req.query;
  if (!code || !state) return back('error', 'missing_code');

  try {
    const { tenantId } = await completeConnect({ code: String(code), state: String(state), redirectUri: redirectUri(req) });
    logger.info(`[crm] HubSpot connected for tenant ${tenantId}`);
    return back('connected');
  } catch (err) {
    logger.error(`[crm] ERROR: HubSpot OAuth callback failed: ${err.message}`);
    const reason = err instanceof HubspotError && err.statusCode === 400 ? 'expired'
      : err instanceof HubspotError && err.statusCode === 409 ? 'conflict'
        : 'exchange_failed';
    return back('error', reason);
  }
});

module.exports = router;
module.exports.redirectUri = redirectUri;
