const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const llmClient = require('../src/engine/llmClient');
const { generateAnswer, describeLlmConfig, ChatUpstreamError, ChatConfigError } = llmClient;
const { rankItems, correctQueryTerms, editDistance } = require('../src/services/shared/lexicalSearch');
const { computeConfidence } = require('../src/engine/confidence');

const ENV_KEYS = ['LLM_PRIMARY', 'LLM_FALLBACK', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_TIMEOUT_MS'];
let savedEnv;
const okResponse = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }], usage: {} }),
  text: async () => ''
});

describe('llmClient: diagnosability and timeouts', () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    mock.restoreAll();
  });

  test('describeLlmConfig names missing key env vars, never key values', () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'openai,anthropic';
    process.env.OPENAI_API_KEY = 'sk-secret-value';
    const info = describeLlmConfig();
    assert.deepEqual(info.chain, ['groq', 'openai', 'anthropic']);
    assert.deepEqual(info.configured, ['openai']);
    assert.deepEqual(info.missingKeys, ['GROQ_API_KEY', 'ANTHROPIC_API_KEY']);
    assert.doesNotMatch(JSON.stringify(info), /sk-secret-value/);
  });

  test('a whitespace-only key counts as missing, and a CRLF-padded key is sent trimmed', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = '   ';
    assert.deepEqual(describeLlmConfig().configured, []);

    process.env.GROQ_API_KEY = 'gsk_real\r';
    let sentAuth;
    mock.method(globalThis, 'fetch', async (_url, opts) => {
      sentAuth = opts.headers.authorization;
      return okResponse('hi');
    });
    await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(sentAuth, 'Bearer gsk_real');
  });

  test('when every provider fails, the thrown error carries every attempt (not just the last)', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'anthropic';
    process.env.GROQ_API_KEY = 'k';
    mock.method(globalThis, 'fetch', async () => { throw new Error('ECONNRESET'); });
    const err = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' }).catch((e) => e);
    assert.ok(err instanceof ChatConfigError); // last: anthropic has no key
    assert.deepEqual(err.attempts.map((a) => [a.provider, a.error]), [
      ['groq', 'ChatUpstreamError'],
      ['anthropic', 'ChatConfigError']
    ]);
    assert.match(llmClient.formatAttempts(err.attempts), /groq: ChatUpstreamError \(Could not reach Groq: ECONNRESET\)/);
  });

  test('a hung provider times out and the chain fails over instead of hanging the request', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.LLM_FALLBACK = 'openai';
    process.env.GROQ_API_KEY = 'k';
    process.env.OPENAI_API_KEY = 'k';
    process.env.LLM_TIMEOUT_MS = '50';
    const warn = mock.method(console, 'warn', () => {});
    mock.method(globalThis, 'fetch', (url, { signal }) => {
      if (url.includes('groq')) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return Promise.resolve(okResponse('from openai'));
    });
    const result = await generateAnswer({ systemPrompt: 's', userPrompt: 'u' });
    assert.equal(result.provider, 'openai');
    assert.match(warn.mock.calls[0].arguments[0], /answered by fallback "openai".*Groq did not respond within 50ms/);
  });

  test('a timeout on the only provider surfaces as ChatUpstreamError (-> degraded answer, not a 500)', async () => {
    process.env.LLM_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = 'k';
    process.env.LLM_TIMEOUT_MS = '20';
    mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_r, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    await assert.rejects(() => generateAnswer({ systemPrompt: 's', userPrompt: 'u' }), ChatUpstreamError);
  });
});

describe('lexicalSearch: corpus-driven typo tolerance', () => {
  const CATALOG = [
    { title: 'Whey Protein', content: 'Our whey protein has 25g of protein per scoop.' },
    { title: 'Creatine', content: 'Creatine monohydrate supports strength. Take one supplement daily.' },
    { title: 'Shipping', content: 'Orders ship within two business days.' }
  ];
  const terms = (q) => q.split(' ').map((raw) => ({ raw, stem: require('porter-stemmer').stemmer(raw) }));

  test('editDistance counts an adjacent swap as one edit', () => {
    assert.equal(editDistance('protien', 'protein', 2), 1);
    assert.equal(editDistance('supplemnt', 'supplement', 2), 1);
    assert.equal(editDistance('abc', 'xyz', 1), 2); // early-exit sentinel is max + 1
  });

  test('misspelled words are corrected to the closest word the knowledge base actually uses', () => {
    const fixed = correctQueryTerms(terms('protien supplemnt monohydrat'), CATALOG);
    assert.deepEqual(fixed.map((t) => t.raw), ['protein', 'supplement', 'monohydrate']);
    assert.deepEqual(fixed.map((t) => t.corrected), ['protien', 'supplemnt', 'monohydrat']);
  });

  test('a variant the stemmer already folds ("creatin" -> creatin) is matched as-is, not "corrected"', () => {
    assert.equal(correctQueryTerms(terms('creatin'), CATALOG)[0].corrected, undefined);
    assert.equal(rankItems('creatin', CATALOG, { minScore: 1 })[0].item.title, 'Creatine');
  });

  test('words the corpus already contains, short words, and numbers are left alone', () => {
    const out = correctQueryTerms(terms('protein scoop 25g ship'), CATALOG);
    assert.ok(out.every((t) => !t.corrected));
  });

  test('no correction when nothing in the corpus is close enough (never invents a match)', () => {
    assert.equal(correctQueryTerms(terms('refund'), CATALOG)[0].corrected, undefined);
    assert.equal(rankItems('refund', CATALOG, { minScore: 1 }).length, 0);
  });

  test('a first-letter change is not a typo correction, unless it is an adjacent swap', () => {
    const corpus = [{ title: 'Kreatin', content: 'kreatin' }];
    assert.equal(correctQueryTerms(terms('creatin'), corpus)[0].corrected, undefined); // c -> k: different word
    const swapCorpus = [{ title: 'Oatmeal', content: 'oatmeal' }];
    assert.equal(correctQueryTerms(terms('aotmeal'), swapCorpus)[0].raw, 'oatmeal');
  });

  test('"protien powder" retrieves the protein section and clears a 30% confidence gate', () => {
    const [top] = rankItems('protien powder', CATALOG, { minScore: 0 });
    assert.equal(top.item.title, 'Whey Protein');
    assert.ok(computeConfidence('protien powder', top.rawScore) >= 0.3);
  });

  test('a typo scores below the correctly spelled query — it gets stem credit, not the exact-match bonus', () => {
    const typo = rankItems('protien', CATALOG, { minScore: 0 })[0].rawScore;
    const exact = rankItems('protein', CATALOG, { minScore: 0 })[0].rawScore;
    assert.ok(typo > 0 && typo < exact);
  });

  test('typoTolerance: false restores strict matching', () => {
    assert.equal(rankItems('protien', CATALOG, { minScore: 1, typoTolerance: false }).length, 0);
  });
});
