const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { skipReason, TEST_URL } = require('../support/realStack');

// Migration integrity against the real test database (already migrated by
// test/support/prepareTestDb.js): every migration in the repo is applied,
// the resulting database matches schema.prisma exactly (no drift — a schema
// change without a migration fails here), and migrations are immutable
// SQL files with sortable timestamped names.

const API_DIR = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(API_DIR, 'prisma', 'migrations');
const prisma = (...args) => spawnSync('npx', ['prisma', ...args], {
  cwd: API_DIR, env: { ...process.env, DATABASE_URL: TEST_URL }, encoding: 'utf8'
});

describe('system: migration integrity', () => {
  test('migration folders are timestamped, ordered, and each holds one migration.sql', () => {
    const dirs = fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.ok(dirs.length > 0);
    for (const dir of dirs) {
      assert.match(dir, /^\d{14}_[a-z0-9_]+$/, dir);
      assert.ok(fs.existsSync(path.join(MIGRATIONS, dir, 'migration.sql')), `${dir}/migration.sql`);
    }
    assert.deepEqual([...dirs].sort(), dirs, 'names sort in apply order');
  });

  test('all migrations are applied to the test database', { skip: skipReason }, () => {
    const r = prisma('migrate', 'status');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Database schema is up to date/);
  });

  test('the migrated database matches schema.prisma — no drift', { skip: skipReason }, () => {
    const r = prisma('migrate', 'diff', '--from-url', TEST_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code');
    // --exit-code: 0 = no difference, 2 = difference
    assert.equal(r.status, 0, `schema.prisma and the migrations disagree:\n${r.stdout}${r.stderr}`);
  });
});
