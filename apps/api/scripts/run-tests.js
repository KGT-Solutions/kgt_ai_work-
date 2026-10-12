#!/usr/bin/env node
// Runs one or more test layers:  node scripts/run-tests.js unit integration
//
// Layers are folders under test/ (see /TESTING.md). Only *.test.js files run:
// `node --test <dir>` would also execute every .js under a folder named
// "test" — including the helpers in test/support — and Node 18/20 have no
// glob support for --test, so the file list is built here instead.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'test');
const LAYERS = ['unit', 'integration', 'db', 'system'];
const PREPARE = new Set(['db', 'system']); // need the test database migrated first

const asked = process.argv.slice(2);
const layers = asked.length ? asked : ['unit', 'integration'];
const unknown = layers.filter((l) => !LAYERS.includes(l));
if (unknown.length) {
  console.error(`Unknown layer(s): ${unknown.join(', ')}. Choose from: ${LAYERS.join(', ')}`);
  process.exit(2);
}

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return files(full);
  return e.name.endsWith('.test.js') ? [full] : [];
});

if (layers.some((l) => PREPARE.has(l))) {
  const prep = spawnSync(process.execPath, [path.join(ROOT, 'support', 'prepareTestDb.js')], { stdio: 'inherit' });
  if (prep.status !== 0) process.exit(prep.status ?? 1);
}

const list = layers.flatMap((l) => files(path.join(ROOT, l)).sort());
console.log(`[tests] ${layers.join(' + ')}: ${list.length} files`);
const run = spawnSync(process.execPath, ['--test', ...list], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(run.status ?? 1);
