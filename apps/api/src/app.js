require('dotenv').config();
const path = require('path');
const express = require('express');
const { corsPolicy } = require('./utils/corsPolicy');
const { wrapRouterAsync } = require('./utils/wrapAsync');
const { errorHandler } = require('./middleware/errorHandler');
const { requireOperator } = require('./middleware/operatorAuth');
const { requireClient } = require('./middleware/clientAuth');

const operatorAuthRoutes = require('./routes/operatorAuth.routes');
const tenantAdminRoutes = require('./routes/tenantAdmin.routes');
const clientAuthRoutes = require('./routes/clientAuth.routes');
const tenantWorkspaceRoutes = require('./routes/tenantWorkspace.routes');
const tenantChatRoutes = require('./routes/tenantChat.routes');
const publicRegisterRoutes = require('./routes/publicRegister.routes');

const app = express();
// The API sits behind one proxy hop (Docker / the reverse proxy), so req.ip
// is the visitor's address from X-Forwarded-For, not the proxy's — without
// this every per-IP rate limit is one shared bucket. TRUST_PROXY_HOPS must
// match the real number of proxies: set it to 0 if the API is ever exposed
// directly, or visitors could spoof X-Forwarded-For to dodge rate limits.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
// Open CORS for the widget and its chat API only; everything else is
// limited to the KGT web app's origins (utils/corsPolicy.js).
app.use(corsPolicy());
// Default 100kb is too small for /public/register/complete, which carries up to
// 25 reviewed pages (see MAX_PAGES_ON_COMPLETE / MAX_CONTENT_LEN there).
app.use(express.json({ limit: '10mb' }));
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

app.use(errorHandler);

module.exports = app;
