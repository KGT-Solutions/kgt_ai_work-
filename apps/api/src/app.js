require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { corsPolicy } = require('./utils/corsPolicy');
const { wrapRouterAsync } = require('./utils/wrapAsync');
const { errorHandler } = require('./middleware/errorHandler');
const { requestId } = require('./middleware/requestId');
const { accessLog } = require('./middleware/accessLog');
const { requireOperator } = require('./middleware/operatorAuth');
const { requireClient } = require('./middleware/clientAuth');

const operatorAuthRoutes = require('./routes/operatorAuth.routes');
const tenantAdminRoutes = require('./routes/tenantAdmin.routes');
const clientAuthRoutes = require('./routes/clientAuth.routes');
const tenantWorkspaceRoutes = require('./routes/tenantWorkspace.routes');
const tenantChatRoutes = require('./routes/tenantChat.routes');
const publicRegisterRoutes = require('./routes/publicRegister.routes');
const publicAuthRoutes = require('./routes/publicAuth.routes');
const crmWebhookRoutes = require('./routes/crmWebhook.routes');
const crmOAuthRoutes = require('./routes/crmOAuth.routes');
const emailOAuthRoutes = require('./routes/emailOAuth.routes');
const sheetsOAuthRoutes = require('./routes/sheetsOAuth.routes');
const hubspotOAuthRoutes = require('./routes/hubspotOAuth.routes');
const brandAssetRoutes = require('./routes/brandAssets.routes');
const chatImageRoutes = require('./routes/chatImages.routes');

const app = express();
// The API sits behind one proxy hop (Docker / the reverse proxy), so req.ip
// is the visitor's address from X-Forwarded-For, not the proxy's — without
// this every per-IP rate limit is one shared bucket. TRUST_PROXY_HOPS must
// match the real number of proxies: set it to 0 if the API is ever exposed
// directly, or visitors could spoof X-Forwarded-For to dodge rate limits.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
// FIRST middleware: tag the request with a correlation id (X-Request-Id, echoed
// back) and open the async-context scope that lib/logger.js reads, so every log
// line for this request — including body-parser errors handled below — carries
// the same id. Registered before helmet so the header is on every response.
app.use(requestId);
// One structured access-log line per request on finish (method/path/status/
// duration + reqId). Right after requestId so req.id exists and the timer spans
// the whole request, including the body parsers and routes below.
app.use(accessLog);
// Standard security headers (HSTS, X-Content-Type-Options, X-Frame-Options,
// a default CSP, referrer policy, etc.). Registered before the routes so every
// response carries them, including the embeddable widget script and the chat API.
//
// The ONE default we relax is Cross-Origin-Resource-Policy: Helmet defaults it to
// `same-origin`, which would make a browser refuse to execute the widget's
// `<script src="{API}/widgets/tenant-chat-widget.js">` tag on a customer's own
// (different-origin) site. `cross-origin` restores that load. This does not widen
// data access: the chat API is still gated by its per-tenant API key and by CORS
// (utils/corsPolicy.js), and the widget injects DOM into the host page rather than
// framing us, so X-Frame-Options / frame-ancestors stay at their safe defaults.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
// Open CORS for the widget and its chat API only; everything else is
// limited to the KGT web app's origins (utils/corsPolicy.js).
app.use(corsPolicy());
// Default 100kb is too small for /public/register/complete, which carries up to
// 25 reviewed pages (see MAX_PAGES_ON_COMPLETE / MAX_CONTENT_LEN there).
// Inbound CRM webhooks (HubSpot, Feature 9) are signed over the EXACT request
// bytes, so stash the raw body for those paths only — the signature can't be
// re-derived from the parsed object. Scoped to /api/v1/webhooks/ to avoid holding
// a second copy of every request body in memory.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/v1/webhooks/')) req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// Tenant chat widget: customers embed it with one
// <script src="{API_BASE}/widgets/tenant-chat-widget.js" data-tenant-id data-api-key> tag.
app.use('/widgets', express.static(path.join(__dirname, '../public/widgets')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// wrapRouterAsync wraps every handler already registered on each router so a
// rejected promise (a DB blip, etc.) reaches the error middleware below via
// next(err) instead of becoming an uncaught rejection that can kill the
// whole process.
//
// One prefix per trust boundary:
//   /api/v1/operator          KGT staff sign-in (then an operator JWT)
//   /api/v1/tenants           every tenant, staff only (requireOperator)
//   /api/v1/client            client sign-in / me (then a client JWT)
//   /api/v1/client/workspace  ONE tenant — the signed-in client's own (requireClient)
//   /api/v1/tenant-chat       Support + Sales bots — per-tenant API key (tenantChat.routes.js)
//   /api/v1/public/register   self-serve signup wizard — unauthenticated, IP rate-limited
// Operator and client tokens are typed (utils/authTokens.js), so neither
// works on the other's routes. The workspace router is shared by staff and
// clients but only ever reads req.tenant, which each gatekeeper sets.
app.use('/api/v1/operator', wrapRouterAsync(operatorAuthRoutes));
app.use('/api/v1/tenants', requireOperator, wrapRouterAsync(tenantAdminRoutes));
app.use('/api/v1/client/workspace', requireClient, tenantWorkspaceRoutes);
app.use('/api/v1/client', wrapRouterAsync(clientAuthRoutes));
app.use('/api/v1/tenant-chat', wrapRouterAsync(tenantChatRoutes));
app.use('/api/v1/public/register', wrapRouterAsync(publicRegisterRoutes));
app.use('/api/v1/public/auth', wrapRouterAsync(publicAuthRoutes)); // signup email OTP
// CRM OAuth consent callback — public (the browser lands here from Zoho),
// authenticated by the signed state it carries (routes/crmOAuth.routes.js).
app.use('/api/v1/public/crm', wrapRouterAsync(crmOAuthRoutes));
// Email send OAuth consent callback — public, authenticated by the signed state
// it carries (routes/emailOAuth.routes.js). Google / Microsoft land here.
app.use('/api/v1/public/email', wrapRouterAsync(emailOAuthRoutes));
// Google Sheets sync OAuth consent callback — public, authenticated by the signed
// state it carries (Feature 8, routes/sheetsOAuth.routes.js).
app.use('/api/v1/public/sheets', wrapRouterAsync(sheetsOAuthRoutes));
// HubSpot CRM OAuth consent callback — public, authenticated by the signed state
// it carries (Feature 9, routes/hubspotOAuth.routes.js).
app.use('/api/v1/public/hubspot', wrapRouterAsync(hubspotOAuthRoutes));
// Uploaded logos for the widget's <img> — public, content-addressed (brandAssets.routes.js).
app.use('/api/v1/public/brand-assets', wrapRouterAsync(brandAssetRoutes));
// Visitor-uploaded chat images for Chat Logs and lead alerts — content-addressed (chatImages.routes.js).
app.use('/api/v1/public/chat-images', wrapRouterAsync(chatImageRoutes));
// Inbound CRM status webhooks — public, authenticated by a shared secret
// (routes/crmWebhook.routes.js), never a client/operator token.
app.use('/api/v1/webhooks', wrapRouterAsync(crmWebhookRoutes));

// An unknown API path answers in JSON like every other API error, not with
// Express's default HTML "Cannot GET" page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(errorHandler);

module.exports = app;
