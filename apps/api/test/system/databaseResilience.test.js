const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

// The real server (src/server.js) started as its own process with its
// database unreachable: it must stay up, keep answering /health, turn
// database failures into a generic JSON 500 (no stack trace, no connection
// string), and not crash on later requests. Needs no database at all.

const API_DIR = path.join(__dirname, '..', '..');
const PORT = 40000 + Math.floor(Math.random() * 20000);
const DEAD_DB = 'postgresql://kgt:secret-db-password@127.0.0.1:1/kgt_unreachable_test?connect_timeout=2';

describe('system: database unavailable', () => {
  let child;
  let output = '';
  const base = `http://127.0.0.1:${PORT}`;

  before(async () => {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: API_DIR,
      env: {
        PATH: process.env.PATH, PORT: String(PORT), DATABASE_URL: DEAD_DB, JWT_SECRET: 'resilience-test-secret-xyz',
        NODE_ENV: 'test', GROQ_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', SMTP_HOST: '', RESEND_API_KEY: '', LLM_PRIMARY: 'openai'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`server did not start:\n${output}`);
  });

  after(() => child?.kill());

  test('/health stays up while the database is down', async () => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
  });

  test('a database-backed request fails as a generic JSON 500 — no internals leak', async () => {
    const r = await fetch(`${base}/api/v1/client/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.test', password: 'whatever-123' })
    });
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.deepEqual(body, { error: 'Internal server error' });
    assert.ok(!JSON.stringify(body).includes('secret-db-password'));
  });

  test('the process survives repeated failures and keeps serving', async () => {
    await Promise.all(Array.from({ length: 5 }, () => fetch(`${base}/api/v1/public/auth/send-otp`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@y.test' })
    })));
    assert.equal(child.exitCode, null, `the server exited:\n${output}`);
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});
