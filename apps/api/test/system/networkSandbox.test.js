const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Canary for the offline sandbox (docker-compose.test.yml sets
// NETWORK_SANDBOX=1): proves the suites really ran with no route to the
// internet, so "zero external calls" is a property of the run, not a hope.
// If this fails, the sandbox network is misconfigured and the other results
// can't be trusted to be offline.

const EXTERNAL = [
  'https://api.groq.com/openai/v1/models',
  'https://api.openai.com/v1/models',
  'https://api.anthropic.com/v1/messages',
  'https://api.resend.com/emails',
  'https://example.com/'
];

describe('system: network sandbox', { skip: process.env.NETWORK_SANDBOX !== '1' && 'only inside docker-compose.test.yml' }, () => {
  for (const url of EXTERNAL) {
    test(`no route to ${new URL(url).host}`, async () => {
      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(5000) }), 'an external request succeeded — the sandbox is not sealed');
    });
  }
});
