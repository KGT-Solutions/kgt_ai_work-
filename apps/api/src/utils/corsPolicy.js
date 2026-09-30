const cors = require('cors');

// Two CORS policies, one per kind of caller:
//   public    any origin — the embed widget runs on customers' own sites.
//             Only the widget script, the widget's chat API and /health.
//   dashboard the KGT web app only (CORS_ORIGINS) — client dashboard, staff
//             console, sign-in, password reset and the signup wizard.
// A browser on any other origin gets no Access-Control-Allow-Origin header,
// so it can't read these responses. Requests without an Origin header
// (curl, server-to-server) are unaffected: CORS is a browser control.

const PUBLIC_PREFIXES = ['/widgets/', '/api/v1/tenant-chat/'];
const DEV_ORIGINS = ['http://localhost:3100', 'http://localhost:3001'];

/** CORS_ORIGINS: comma-separated, e.g. "https://hub.example.com,https://admin.example.com". */
function allowedOrigins(env = process.env) {
  const listed = String(env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return listed.length ? listed : DEV_ORIGINS;
}

function isPublicPath(path) {
  return path === '/health' || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

function corsPolicy(env = process.env) {
  const publicCors = cors();
  const dashboardCors = cors({ origin: allowedOrigins(env) });
  return (req, res, next) => (isPublicPath(req.path) ? publicCors : dashboardCors)(req, res, next);
}

module.exports = { corsPolicy, allowedOrigins, isPublicPath, DEV_ORIGINS };
