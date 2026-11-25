const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// spamCheck calls the LLM through the module object (llm.generateAnswer), not a
// destructured reference, so replacing these after require takes effect.
const llm = require('../../src/engine/llmClient');
const { looksLikeSpam, isSpamCheckpoint, SPAM_CHECK_TURNS } = require('../../src/services/shared/spamCheck');

let origConfigured, origGenerate, generateArgs;
beforeEach(() => {
  origConfigured = llm.isLlmConfigured;
  origGenerate = llm.generateAnswer;
  generateArgs = [];
  llm.isLlmConfigured = () => true;
  llm.generateAnswer = async (args) => { generateArgs.push(args); return { text: 'OK' }; };
});
afterEach(() => {
  llm.isLlmConfigured = origConfigured;
  llm.generateAnswer = origGenerate;
});

const visitor = (content) => ({ role: 'user', content });
const bot = (content) => ({ role: 'assistant', content });

describe('isSpamCheckpoint — the escalating turn counts', () => {
  test('fires at visitor messages #2, #4, #8 and #16, and nowhere else', () => {
    assert.deepEqual(SPAM_CHECK_TURNS, [2, 4, 8, 16]);
    for (const n of [2, 4, 8, 16]) assert.equal(isSpamCheckpoint(n), true, `#${n} is a checkpoint`);
    for (const n of [1, 3, 5, 6, 7, 9, 15, 17, 32]) assert.equal(isSpamCheckpoint(n), false, `#${n} is not`);
  });
});

describe('looksLikeSpam — the model verdict', () => {
  test('a SPAM verdict is true; the prompt only carries the visitor messages', async () => {
    llm.generateAnswer = async (args) => { generateArgs.push(args); return { text: 'SPAM' }; };
    const spam = await looksLikeSpam({ messages: [visitor('buy cheap pills http://x'), bot('How can I help?'), visitor('buy buy buy')] });
    assert.equal(spam, true);
    assert.equal(generateArgs.length, 1);
    assert.match(generateArgs[0].userPrompt, /buy cheap pills/);
    assert.doesNotMatch(generateArgs[0].userPrompt, /How can I help/, 'the bot\'s own replies are not evidence of visitor spam');
  });

  test('an OK verdict is false', async () => {
    const spam = await looksLikeSpam({ messages: [visitor('what are your hours?')] });
    assert.equal(spam, false);
  });

  test('fails OPEN: no provider configured means not spam, and no model call', async () => {
    llm.isLlmConfigured = () => false;
    const spam = await looksLikeSpam({ messages: [visitor('anything')] });
    assert.equal(spam, false);
    assert.equal(generateArgs.length, 0);
  });

  test('fails OPEN: a classifier error means not spam (never silence a real customer)', async () => {
    llm.generateAnswer = async () => { throw new Error('provider down'); };
    assert.equal(await looksLikeSpam({ messages: [visitor('hello')] }), false);
  });

  test('an empty visitor transcript is never spam and never calls the model', async () => {
    assert.equal(await looksLikeSpam({ messages: [bot('hi there')] }), false);
    assert.equal(await looksLikeSpam({ messages: [] }), false);
    assert.equal(generateArgs.length, 0);
  });
});
