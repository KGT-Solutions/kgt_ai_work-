const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseGuardrailsInput, defaults } = require('../../src/services/guardrails');

describe('guardrails scaffold — defaults', () => {
  test('a tenant with no row reads as platform defaults', () => {
    assert.deepEqual(defaults(), {
      maxMessages: null, windowSeconds: null, limitMessage: null,
      spamCheckEnabled: false, blockedCountries: [], imagesEnabled: true,
      voiceMonthlyMinutes: null
    });
  });
});

describe('guardrails scaffold — parseGuardrailsInput', () => {
  test('accepts a full valid body; countries upper-cased + deduped; message trimmed', () => {
    const r = parseGuardrailsInput({
      maxMessages: 5, windowSeconds: 30, limitMessage: '  slow down  ',
      spamCheckEnabled: true, blockedCountries: ['ru', 'RU', 'cn'], imagesEnabled: false
    });
    assert.equal(r.ok, true);
    assert.equal(r.data.maxMessages, 5);
    assert.equal(r.data.windowSeconds, 30);
    assert.equal(r.data.limitMessage, 'slow down');
    assert.equal(r.data.spamCheckEnabled, true);
    assert.deepEqual(r.data.blockedCountries, ['RU', 'CN']);
    assert.equal(r.data.imagesEnabled, false);
  });

  test('voiceMonthlyMinutes: 0 (unlimited) is valid, null clears it, negatives are rejected', () => {
    assert.equal(parseGuardrailsInput({ voiceMonthlyMinutes: 0 }).data.voiceMonthlyMinutes, 0);
    assert.equal(parseGuardrailsInput({ voiceMonthlyMinutes: 500 }).data.voiceMonthlyMinutes, 500);
    assert.equal(parseGuardrailsInput({ voiceMonthlyMinutes: null }).data.voiceMonthlyMinutes, null);
    assert.equal(parseGuardrailsInput({ voiceMonthlyMinutes: -1 }).ok, false);
  });

  test('is a partial update — only present keys appear', () => {
    assert.deepEqual(Object.keys(parseGuardrailsInput({ imagesEnabled: false }).data), ['imagesEnabled']);
  });

  test('empty / non-object / no-op bodies are rejected', () => {
    assert.equal(parseGuardrailsInput({}).ok, false);
    assert.equal(parseGuardrailsInput(null).ok, false);
    assert.equal(parseGuardrailsInput('x').ok, false);
  });

  test('numeric ranges are enforced; null clears a value', () => {
    assert.equal(parseGuardrailsInput({ maxMessages: 0 }).ok, false);
    assert.equal(parseGuardrailsInput({ maxMessages: 1001 }).ok, false);
    assert.equal(parseGuardrailsInput({ maxMessages: 2.5 }).ok, false);
    assert.equal(parseGuardrailsInput({ windowSeconds: 0 }).ok, false);
    assert.equal(parseGuardrailsInput({ windowSeconds: 99999 }).ok, false);
    assert.equal(parseGuardrailsInput({ maxMessages: null }).data.maxMessages, null);
  });

  test('bad country codes, over-long lists, and non-booleans are rejected', () => {
    assert.equal(parseGuardrailsInput({ blockedCountries: ['USA'] }).ok, false);
    assert.equal(parseGuardrailsInput({ blockedCountries: 'US' }).ok, false);
    assert.equal(parseGuardrailsInput({ blockedCountries: new Array(251).fill('US') }).ok, false);
    assert.equal(parseGuardrailsInput({ spamCheckEnabled: 'yes' }).ok, false);
    assert.equal(parseGuardrailsInput({ imagesEnabled: 1 }).ok, false);
  });

  test('limitMessage is capped at 300 chars; empty clears it', () => {
    assert.equal(parseGuardrailsInput({ limitMessage: 'a'.repeat(400) }).data.limitMessage.length, 300);
    assert.equal(parseGuardrailsInput({ limitMessage: '' }).data.limitMessage, null);
  });
});
