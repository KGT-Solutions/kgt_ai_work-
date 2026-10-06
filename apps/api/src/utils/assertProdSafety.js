// Fail loudly at boot rather than silently running with an insecure
// default — a bypassed OTP flow or a forgeable JWT would otherwise only
// show up as a security incident, with nothing in the logs pointing back to
// a missing/misconfigured env var. Pulled out as a pure function (env in,
// throw or not) so it's unit-testable without booting the real server.
//
// Every problem is collected and reported in ONE error, each with why it
// failed and how to fix it, so a deployment doesn't crash-loop on the first
// problem, get fixed, then crash on the next. Secret values are never printed.
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

const MIN_SECRET_LENGTH = 16;
const MIN_DISTINCT_CHARS = 6;
// Whole values that are obviously not secrets (compared case-insensitively,
// ignoring "-", "_" and spaces, so "Change_Me" matches "change-me").
const PLACEHOLDER_VALUES = [
  'dev-secret-change-me', 'change-me', 'change-me-please', 'secret', 'jwt-secret', 'jwt-secret-key', 'your-secret',
  'your-jwt-secret', 'my-secret', 'supersecret', 'super-secret', 'secret-key', 'password', 'replace-me', 'todo', 'test', 'example'
];
// Text that marks a value as a template someone forgot to fill in, wherever it appears.
const PLACEHOLDER_MARKERS = ['changeme', 'replaceme', 'yoursecret', 'placeholder', 'example', 'xxxxxx'];
const squash = (s) => s.toLowerCase().replace(/[-_\s]/g, '');

const ENV_FILE_HINT = 'The Docker API container reads .env.docker only (apps/api/.env is excluded from the image). ' +
  'After editing it, recreate the container so the new values load — no rebuild needed: ' +
  'docker compose --env-file .env.docker up -d api   (a plain `docker restart` keeps the old values).';

/**
 * Why a JWT_SECRET is unusable in production, or null if it's fine.
 * @param {string|undefined} raw
 * @returns {string|null}
 */
function jwtSecretProblem(raw) {
  if (raw === undefined || raw === null || raw === '') return 'it is not set';
  const value = String(raw);
  const trimmed = value.trim();
  if (!trimmed) return 'it is only whitespace';
  if (trimmed !== value) return 'it has leading or trailing whitespace (often a stray space after "=" in the env file)';
  const unquoted = trimmed.replace(/^(["'])(.*)\1$/, '$2');
  const key = squash(unquoted);
  if (PLACEHOLDER_VALUES.some((p) => squash(p) === key)) {
    return unquoted === 'dev-secret-change-me'
      ? 'it is still the committed placeholder "dev-secret-change-me"'
      : 'it is a well-known placeholder value';
  }
  if (PLACEHOLDER_MARKERS.some((m) => key.includes(m))) return 'it contains placeholder text (e.g. "change-me" / "example")';
  if (unquoted.length < MIN_SECRET_LENGTH) return `it is ${unquoted.length} characters long; at least ${MIN_SECRET_LENGTH} are required`;
  if (new Set(unquoted).size < MIN_DISTINCT_CHARS) return 'it repeats too few distinct characters to be a real secret';
  return null;
}

class ProdSafetyError extends Error {
  constructor(problems) {
    super(
      `Refusing to start with DEPLOY_ENV=production — ${problems.length} configuration problem${problems.length === 1 ? '' : 's'}:\n` +
      problems.map((p, i) => `  ${i + 1}. ${p.message}\n     fix: ${p.fix}`).join('\n') +
      `\n  ${ENV_FILE_HINT}`
    );
    this.name = 'ProdSafetyError';
    this.problems = problems;
  }
}

/**
 * @param {object} [env]
 * @throws {ProdSafetyError} listing every problem found
 */
function assertProdSafety(env = process.env) {
  if (env.DEPLOY_ENV !== 'production') return;
  const problems = [];

  if (env.DEV_BYPASS_AUTH === 'true') {
    problems.push({
      key: 'DEV_BYPASS_AUTH',
      message: 'DEV_BYPASS_AUTH must not be enabled when DEPLOY_ENV=production',
      fix: 'remove DEV_BYPASS_AUTH from the env file, or set it to false'
    });
  }
  const secretProblem = jwtSecretProblem(env.JWT_SECRET);
  if (secretProblem) {
    problems.push({
      key: 'JWT_SECRET',
      message: `JWT_SECRET must be set to a real secret when DEPLOY_ENV=production — rejected because ${secretProblem}`,
      fix: `set JWT_SECRET to a random value of ${MIN_SECRET_LENGTH}+ characters, e.g. the output of: openssl rand -hex 32 ` +
        '(changing it signs every user out once)'
    });
  }
  // Without it the dashboard APIs only accept localhost origins, so the
  // deployed web app couldn't reach them (utils/corsPolicy.js).
  if (!String(env.CORS_ORIGINS || '').trim()) {
    problems.push({
      key: 'CORS_ORIGINS',
      message: 'CORS_ORIGINS must list the web app origin(s) when DEPLOY_ENV=production',
      fix: 'set CORS_ORIGINS to the dashboard\'s public origin(s), comma-separated, e.g. CORS_ORIGINS=https://hub.example.com'
    });
  }

  if (problems.length) throw new ProdSafetyError(problems);
}

module.exports = { assertProdSafety, jwtSecretProblem, ProdSafetyError, MIN_SECRET_LENGTH };
