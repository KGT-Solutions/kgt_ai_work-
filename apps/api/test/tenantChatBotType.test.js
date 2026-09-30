const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseBotType } = require('../src/services/tenantChat');

describe('tenantChat: parseBotType', () => {
  test('defaults to support when omitted', () => {
    assert.deepEqual(parseBotType({}), { ok: true, value: 'support' });
    assert.deepEqual(parseBotType(undefined), { ok: true, value: 'support' });
    assert.deepEqual(parseBotType({ botType: '' }), { ok: true, value: 'support' });
  });

  test('accepts botType and the widget-style bot alias, case-insensitively', () => {
    assert.deepEqual(parseBotType({ botType: 'sales' }), { ok: true, value: 'sales' });
    assert.deepEqual(parseBotType({ bot: 'Sales ' }), { ok: true, value: 'sales' });
    assert.deepEqual(parseBotType({ bot: 'SUPPORT' }), { ok: true, value: 'support' });
  });

  test('botType wins over bot when both are sent', () => {
    assert.equal(parseBotType({ botType: 'support', bot: 'sales' }).value, 'support');
  });

  test('rejects unknown bots instead of silently answering as support', () => {
    const r = parseBotType({ botType: 'marketing' });
    assert.equal(r.ok, false);
    assert.match(r.error, /support, sales/);
  });
});
