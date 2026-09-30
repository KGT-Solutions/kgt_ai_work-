// Fail loudly at boot rather than silently running with an insecure
// default — a bypassed OTP flow or a forgeable JWT would otherwise only
// show up as a security incident, with nothing in the logs pointing back to
// a missing/misconfigured env var. Pulled out as a pure function (env in,
// throw or not) so it's unit-testable without booting the real server.
//
// Deliberately keyed on DEPLOY_ENV, NOT NODE_ENV: this project's own
// Dockerfile always sets NODE_ENV=production (Express wants that for its
// own performance behavior) even for the local/staging docker-compose
// stack, which ALSO deliberately ships DEV_BYPASS_AUTH=true in .env.docker
// for convenience. Keying this check off NODE_ENV made every docker-compose
// boot throw here before app.listen() ever ran — a real crash caused by
// this exact guard (caught and fixed the same session it shipped). A real
// production deployment must explicitly set DEPLOY_ENV=production in its
// own environment for this to have any effect; nothing here does that
// automatically.
function assertProdSafety(env = process.env) {
  if (env.DEPLOY_ENV !== 'production') return;

  if (env.DEV_BYPASS_AUTH === 'true') {
    throw new Error('DEV_BYPASS_AUTH must not be enabled when DEPLOY_ENV=production');
  }
  if (!env.JWT_SECRET || env.JWT_SECRET === 'dev-secret-change-me') {
    throw new Error('JWT_SECRET must be set to a real secret when DEPLOY_ENV=production');
  }
  // Without it the dashboard APIs only accept localhost origins, so the
  // deployed web app couldn't reach them (utils/corsPolicy.js).
  if (!String(env.CORS_ORIGINS || '').trim()) {
    throw new Error('CORS_ORIGINS must list the web app origin(s) when DEPLOY_ENV=production');
  }
}

module.exports = { assertProdSafety };
