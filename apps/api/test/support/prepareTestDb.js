// Brings the test database up to date before the db / system layers run:
//   node test/support/prepareTestDb.js
// Applies every migration to TEST_DATABASE_URL (creating the database if
// needed). Refuses any database whose name doesn't contain "test" — this
// must never touch a real one. Without TEST_DATABASE_URL it does nothing,
// and those suites skip themselves.
const { spawnSync } = require('child_process');
const path = require('path');
const { skipReason, TEST_URL, databaseName } = require('./realStack');

if (!TEST_URL) {
  console.log('[prepareTestDb] TEST_DATABASE_URL not set — db and system suites will be skipped.');
  process.exit(0);
}
if (skipReason) {
  console.error(`[prepareTestDb] ${skipReason}`);
  process.exit(1);
}
console.log(`[prepareTestDb] applying migrations to "${databaseName(TEST_URL)}"…`);
const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: path.join(__dirname, '..', '..'),
  env: { ...process.env, DATABASE_URL: TEST_URL },
  stdio: 'inherit'
});
process.exit(r.status ?? 1);
