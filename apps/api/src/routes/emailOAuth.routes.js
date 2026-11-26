const express = require('express');
const { logger } = require('../lib/logger');
const { completeConnect, EmailConnectionError } = require('../services/emailConnection');
const { isProvider } = require('../services/emailOAuth');

// Public email OAuth callback. Google / Microsoft redirect the tenant's browser
// here after they grant (or decline) send-only consent:
//
//   GET /api/v1/public/email/:provider/callback?code=...&state=...
//
// Not authenticated by a dashboard token — the signed `state` binds the flow to
// a tenant + provider (services/emailConnection.js). On success the tokens are
// exchanged and stored (encrypted), then the browser is sent back to the
// dashboard Email settings page with a result flag. Any failure becomes a tidy
// redirect with ?email=error, never an HTML 500.
const router = express.Router();

/**
 * Where the provider sends the code back. Must match a redirect URI registered
 * on the OAuth app and be identical for the authorize step and this exchange,
 * so it's pinned per provider by env, falling back to this request's own host.
 */
function redirectUri(req, provider) {
  const p = String(provider || '').toLowerCase();
  const fromEnv = String(process.env[`${p === 'google' ? 'GOOGLE' : 'MICROSOFT'}_OAUTH_REDIRECT_URI`] || '').trim();
  if (fromEnv) return fromEnv;
  return `${req.protocol}://${req.get('host')}/api/v1/public/email/${p}/callback`;
}

function dashboardReturn(result, reason) {
  const base = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({ email: result, ...(reason ? { reason } : {}) }).toString();
  return base ? `${base}/dashboard/smtp?${qs}` : null;
}

router.get('/:provider/callback', async (req, res) => {
  const back = (result, reason) => {
    const url = dashboardReturn(result, reason);
    if (url) return res.redirect(url);
    return res.status(result === 'connected' ? 200 : 400).json({ email: result, reason });
  };

  if (!isProvider(req.params.provider)) return back('error', 'unknown_provider');
  if (req.query.error) return back('error', String(req.query.error).slice(0, 80));
  const { code, state } = req.query;
  if (!code || !state) return back('error', 'missing_code');

  try {
    const { tenantId, provider } = await completeConnect({
      code: String(code), state: String(state), redirectUri: redirectUri(req, req.params.provider)
    });
    logger.info(`[email] ${provider} connected for tenant ${tenantId}`);
    return back('connected');
  } catch (err) {
    logger.error(`[email] ERROR: ${req.params.provider} OAuth callback failed: ${err.message}`);
    const reason = err instanceof EmailConnectionError && err.statusCode === 400 ? 'expired' : 'exchange_failed';
    return back('error', reason);
  }
});

module.exports = router;
module.exports.redirectUri = redirectUri;
