require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { wrapRouterAsync } = require('./utils/wrapAsync');
const { errorHandler } = require('./middleware/errorHandler');
const { requireOperator } = require('./middleware/operatorAuth');

const operatorAuthRoutes = require('./routes/operatorAuth.routes');
const tenantAdminRoutes = require('./routes/tenantAdmin.routes');
const tenantChatRoutes = require('./routes/tenantChat.routes');
const publicRegisterRoutes = require('./routes/publicRegister.routes');

const app = express();
app.use(cors());
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
// Four separate prefixes, one per trust boundary:
//   /api/v1/operator         operator console sign-in (public login, then JWT)
//   /api/v1/tenants          tenant management — operators only
//   /api/v1/tenant-chat      Support + Sales bots — per-tenant API key (tenantChat.routes.js)
//   /api/v1/public/register  self-serve signup wizard — unauthenticated, IP rate-limited
// Kept apart so an auth middleware bound to one prefix never runs for another.
app.use('/api/v1/operator', wrapRouterAsync(operatorAuthRoutes));
app.use('/api/v1/tenants', requireOperator, wrapRouterAsync(tenantAdminRoutes));
app.use('/api/v1/tenant-chat', wrapRouterAsync(tenantChatRoutes));
app.use('/api/v1/public/register', wrapRouterAsync(publicRegisterRoutes));

app.use(errorHandler);

module.exports = app;
