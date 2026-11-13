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

/**
 * Why an ENCRYPTION_KEY is unusable in production, or null if it's fine. The
 * acceptance rules are the same as a JWT secret (set, unpadded, not a known
 * placeholder, long and varied enough). ENCRYPTION_KEY is the master secret for
 * the AES-256-GCM encryption of Zoho CRM refresh tokens and SMTP passwords at
 * rest (utils/encryption.js); a missing or weak one otherwise surfaces only as a
 * decrypt failure on the first secret read, so it must stop boot instead.
 * @param {string|undefined} raw
 * @returns {string|null}
 */
function encryptionKeyProblem(raw) {
  return jwtSecretProblem(raw);
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
  const encProblem = encryptionKeyProblem(env.ENCRYPTION_KEY);
  if (encProblem) {
    problems.push({
      key: 'ENCRYPTION_KEY',
      message: 'ENCRYPTION_KEY must be set to a real secret when DEPLOY_ENV=production — it encrypts Zoho CRM ' +
        `tokens and SMTP passwords at rest — rejected because ${encProblem}`,
      fix: `set ENCRYPTION_KEY to a random value of ${MIN_SECRET_LENGTH}+ characters, e.g. the output of: openssl rand -hex 32 ` +
        '(rotating it makes existing encrypted secrets unreadable — re-save them after a change)'
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

  // Test-only switches (the sandboxed E2E stack): each one weakens a guard.
  const on = (k) => String(env[k] || '').trim().toLowerCase() === 'true';
  if (on('CRAWLER_ALLOW_PRIVATE_HOSTS')) {
    problems.push({
      key: 'CRAWLER_ALLOW_PRIVATE_HOSTS',
      message: 'CRAWLER_ALLOW_PRIVATE_HOSTS lets the website crawler reach internal addresses (SSRF) and is for tests only',
      fix: 'remove CRAWLER_ALLOW_PRIVATE_HOSTS from the env file'
    });
  }
  if (on('SMTP_ALLOW_INSECURE')) {
    problems.push({
      key: 'SMTP_ALLOW_INSECURE',
      message: 'SMTP_ALLOW_INSECURE sends email (including sign-in codes) without TLS and is for tests only',
      fix: 'remove SMTP_ALLOW_INSECURE from the env file'
    });
  }
  const llmBase = String(env.OPENAI_BASE_URL || '').trim();
  if (llmBase && !/^https:\/\//i.test(llmBase)) {
    problems.push({
      key: 'OPENAI_BASE_URL',
      message: 'OPENAI_BASE_URL must be an https:// URL when DEPLOY_ENV=production',
      fix: 'remove OPENAI_BASE_URL (defaults to https://api.openai.com/v1) or set an https endpoint'
    });
  }

  // Multi-replica correctness: in production the shared state (rate limits,
  // cache invalidation, background-job locks) must live in Redis, or several
  // API replicas silently disagree with each other (lib/sharedStore.js). A
  // deliberate single-container deployment opts out with API_REPLICAS=1.
  const sharedStore = String(env.SHARED_STORE || '').trim().toLowerCase();
  const singleReplica = String(env.API_REPLICAS || '').trim() === '1';
  if (sharedStore !== 'redis' && !singleReplica) {
    problems.push({
      key: 'SHARED_STORE',
      message: 'SHARED_STORE must be "redis" when DEPLOY_ENV=production — with more than one API replica, in-process ' +
        'rate limits, cache invalidation and background-job locks do not agree across replicas',
      fix: 'set SHARED_STORE=redis and REDIS_URL (e.g. redis://redis:6379); for a deliberate single container set API_REPLICAS=1'
    });
  } else if (sharedStore === 'redis' && !String(env.REDIS_URL || '').trim()) {
    problems.push({
      key: 'REDIS_URL',
      message: 'SHARED_STORE=redis requires REDIS_URL when DEPLOY_ENV=production',
      fix: 'set REDIS_URL, e.g. redis://redis:6379'
    });
  }

  if (problems.length) throw new ProdSafetyError(problems);
}

module.exports = { assertProdSafety, jwtSecretProblem, encryptionKeyProblem, ProdSafetyError, MIN_SECRET_LENGTH };
