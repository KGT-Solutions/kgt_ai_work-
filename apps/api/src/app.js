require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { authenticate } = require('./middleware/auth');
const { requireSuperAdmin } = require('./middleware/rbac');
const { wrapRouterAsync } = require('./utils/wrapAsync');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const buildingRoutes = require('./routes/buildings.routes');
const billRoutes = require('./routes/bills.routes');
const complaintRoutes = require('./routes/complaints.routes');
const visitorRoutes = require('./routes/visitors.routes');
const facilityRoutes = require('./routes/facilities.routes');
const voteRoutes = require('./routes/votes.routes');
const announcementRoutes = require('./routes/announcements.routes');
const emergencyRoutes = require('./routes/emergency.routes');
const marketplaceRoutes = require('./routes/marketplace.routes');
const notificationRoutes = require('./routes/notifications.routes');
const familyRoutes = require('./routes/family.routes');
const vehicleRoutes = require('./routes/vehicles.routes');
const bugRoutes = require('./routes/bugs.routes');
const chatRoutes = require('./routes/chat.routes');
const salesChatRoutes = require('./routes/salesChat.routes');
const salesLeadsRoutes = require('./routes/salesLeads.routes');
const tenantAdminRoutes = require('./routes/tenantAdmin.routes');
const tenantChatRoutes = require('./routes/tenantChat.routes');
const publicRegisterRoutes = require('./routes/publicRegister.routes');
require('./actions'); // registers every chat-engine action handler (must run before any chat request)

const app = express();
app.use(cors());
// Default 100kb is too small for /public/register/complete, which carries up to
// 25 reviewed pages (see MAX_PAGES_ON_COMPLETE / MAX_CONTENT_LEN there).
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// Sales Chat Widget: served here (not embedded in a specific app) so any external marketing
// site can embed it with one <script src="{API_BASE}/widgets/sales-chat-widget.js"> tag.
app.use('/widgets', express.static(path.join(__dirname, '../public/widgets')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// wrapRouterAsync wraps every handler already registered on each router so a
// rejected promise (a DB blip, etc.) reaches the error middleware below via
// next(err) instead of becoming an uncaught rejection that can kill the
// whole process — a single safety net applied once here rather than
// depending on every route file remembering its own try/catch.
app.use('/auth', wrapRouterAsync(authRoutes));
app.use('/buildings', authenticate, wrapRouterAsync(buildingRoutes));
app.use('/bills', authenticate, wrapRouterAsync(billRoutes));
app.use('/finance', authenticate, wrapRouterAsync(require('./routes/finance.routes')));
app.use('/complaints', authenticate, wrapRouterAsync(complaintRoutes));
app.use('/visitors', authenticate, wrapRouterAsync(visitorRoutes));
app.use('/facilities', authenticate, wrapRouterAsync(facilityRoutes));
app.use('/votes', authenticate, wrapRouterAsync(voteRoutes));
app.use('/announcements', authenticate, wrapRouterAsync(announcementRoutes));
app.use('/emergency-contacts', authenticate, wrapRouterAsync(emergencyRoutes));
app.use('/marketplace', authenticate, wrapRouterAsync(marketplaceRoutes));
app.use('/notifications', authenticate, wrapRouterAsync(notificationRoutes));
app.use('/family-members', authenticate, wrapRouterAsync(familyRoutes));
app.use('/vehicles', authenticate, wrapRouterAsync(vehicleRoutes));
app.use('/bugs', authenticate, wrapRouterAsync(bugRoutes));
// Public first: prospects (builders/RWA presidents/committee members) aren't logged-in FLATBRIZ
// users. It only defines POST /sales, so any other /api/v1/chat/* request falls through to the
// authenticated router below. (authenticate is bound to the whole /api/v1/chat prefix, so it must
// not run before this router gets a chance to match /sales.)
app.use('/api/v1/chat', wrapRouterAsync(salesChatRoutes));
app.use('/api/v1/chat', authenticate, wrapRouterAsync(chatRoutes));
app.use('/api/v1/sales-leads', authenticate, requireSuperAdmin, wrapRouterAsync(salesLeadsRoutes));
// Multi-tenant engine (resold/white-label customers, any industry). Admin management is
// super-admin only; the chat endpoint is public but per-tenant API-key gated (tenantChat.routes.js)
// since end customers' own apps call it directly, not through FLATBRIZ auth. Deliberately separate
// path prefixes (not just separate middleware on /api/v1/tenants) — authenticate/requireSuperAdmin
// would otherwise run for every request under a shared prefix regardless of mount order.
app.use('/api/v1/tenants', authenticate, requireSuperAdmin, wrapRouterAsync(tenantAdminRoutes));
app.use('/api/v1/tenant-chat', wrapRouterAsync(tenantChatRoutes));
// Public self-serve onboarding wizard (apps/admin-web/pages/register.js) —
// deliberately unauthenticated; see publicRegister.routes.js for the trust
// boundary this crosses and how it's mitigated (IP rate limits, server-side
// caps). A different prefix from /api/v1/tenants on purpose, same reasoning
// as tenant-chat above.
app.use('/api/v1/public/register', wrapRouterAsync(publicRegisterRoutes));

app.use(errorHandler);

module.exports = app;
