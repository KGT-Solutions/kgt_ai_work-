const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Indexes a hot query depends on, pinned so a schema edit can't silently drop
// one. The schema and a migration must both carry it — a schema-only index
// never reaches the database.

const PRISMA = path.join(__dirname, '../../prisma');

function allMigrationSql() {
  const dir = path.join(PRISMA, 'migrations');
  return fs.readdirSync(dir)
    .map((name) => path.join(dir, name, 'migration.sql'))
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

test('Lead is indexed on (crmProvider, crmRecordId) for the inbound Zoho webhook lookup', () => {
  const schema = fs.readFileSync(path.join(PRISMA, 'schema.prisma'), 'utf8');
  const lead = schema.match(/model Lead \{[\s\S]*?\n\}/)[0];
  assert.match(lead, /@@index\(\[crmProvider, crmRecordId\]\)/);
  assert.match(allMigrationSql(), /CREATE INDEX "Lead_crmProvider_crmRecordId_idx" ON "Lead"\("crmProvider", "crmRecordId"\);/);
});
