const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { flatbrizSupportProfile, OUT_OF_SCOPE_MESSAGE } = require('../src/domains/flatbrizSupport.profile');

describe('flatbrizSupportProfile.systemPrompt — persona and guardrails', () => {
  test('addresses the resident by the correct role label', () => {
    const prompt = flatbrizSupportProfile.systemPrompt({ userRole: 'resident' });
    assert.match(prompt, /answering a resident/);
  });

  test('addresses a guard and an admin with their own labels', () => {
    assert.match(flatbrizSupportProfile.systemPrompt({ userRole: 'guard' }), /answering a security guard/);
    assert.match(
      flatbrizSupportProfile.systemPrompt({ userRole: 'admin' }),
      /answering a building admin or committee member/
    );
  });

  test('falls back to a generic label for an unrecognized role', () => {
    assert.match(flatbrizSupportProfile.systemPrompt({ userRole: 'prospect' }), /answering a FLATBRIZ user/);
    assert.match(flatbrizSupportProfile.systemPrompt({ userRole: undefined }), /answering a FLATBRIZ user/);
  });

  test('embeds the exact sentinel token the engine checks for verbatim', () => {
    const prompt = flatbrizSupportProfile.systemPrompt({ userRole: 'resident' });
    assert.match(prompt, /NO_ANSWER_IN_MANUAL/);
    assert.equal(flatbrizSupportProfile.noAnswerSentinel, 'NO_ANSWER_IN_MANUAL');
  });

  test('instructs the model to answer only from excerpts and never claim to take actions', () => {
    const prompt = flatbrizSupportProfile.systemPrompt({ userRole: 'resident' });
    assert.match(prompt, /Answer ONLY using the "MANUAL EXCERPTS"/);
    assert.match(prompt, /Never claim to take actions/);
  });
});

describe('flatbrizSupportProfile.filterChunks — per-role manual access', () => {
  const chunks = [
    { title: 'Logging In', sourceFile: 'resident-manual.md' },
    { title: 'Vehicles', sourceFile: 'resident-manual.md' },
    { title: 'Approving Memberships', sourceFile: 'admin-manual.md' }
  ];

  test('a resident only sees resident-manual.md content', () => {
    const filtered = flatbrizSupportProfile.filterChunks(chunks, { userRole: 'resident' });
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((c) => c.sourceFile === 'resident-manual.md'));
  });

  test('a guard is scoped identically to a resident', () => {
    const filtered = flatbrizSupportProfile.filterChunks(chunks, { userRole: 'guard' });
    assert.equal(filtered.length, 2);
  });

  test('an admin sees both manuals — the one role allowed cross-file access', () => {
    const filtered = flatbrizSupportProfile.filterChunks(chunks, { userRole: 'admin' });
    assert.equal(filtered.length, 3);
  });

  test('an unrecognized role sees nothing, not everything — fails closed', () => {
    const filtered = flatbrizSupportProfile.filterChunks(chunks, { userRole: 'sales_prospect' });
    assert.deepEqual(filtered, []);
  });
});

describe('flatbrizSupportProfile.boostTags — vehicle entity synonym routing', () => {
  test('detects "car" and boosts entity:vehicle', () => {
    const tags = flatbrizSupportProfile.boostTags({}, 'How do I register my car?');
    assert.ok(tags.has('entity:vehicle'));
  });

  const synonyms = ['bike', 'vehicle', 'parking', 'park', 'license', 'licence', 'plate'];
  for (const word of synonyms) {
    test(`detects the synonym "${word}"`, () => {
      const tags = flatbrizSupportProfile.boostTags({}, `question about ${word} here`);
      assert.ok(tags.has('entity:vehicle'), `expected entity:vehicle for "${word}"`);
    });
  }

  test('is case-insensitive', () => {
    const tags = flatbrizSupportProfile.boostTags({}, 'How do I register my CAR?');
    assert.ok(tags.has('entity:vehicle'));
  });

  test('does not fire on an unrelated query, and returns undefined (not an empty Set)', () => {
    const tags = flatbrizSupportProfile.boostTags({}, 'How do I pay my maintenance bill?');
    assert.equal(tags, undefined);
  });

  test('does not fire on a substring collision (e.g. "parkway" must not match "park")', () => {
    // Guards the tokenizer split against naive substring matching — words are
    // split on non-letters and matched as whole tokens via .includes on the array.
    const tags = flatbrizSupportProfile.boostTags({}, 'Where is the parkway entrance?');
    assert.equal(tags, undefined);
  });
});

describe('flatbrizSupportProfile.formatFallback — out-of-scope / gate-failed response', () => {
  test('returns the fixed out-of-scope message with a null source section', () => {
    const result = flatbrizSupportProfile.formatFallback();
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.equal(result.sourceSection, null);
  });
});

describe('flatbrizSupportProfile.formatSuccess — answer + citation shape', () => {
  const rankedChunks = [
    { chunk: { title: 'Vehicles', content: '...' }, score: 10 },
    { chunk: { title: 'Logging In', content: '...' }, score: 2 }
  ];

  test('cites the first (already-reordered) ranked chunk as the source section', () => {
    const result = flatbrizSupportProfile.formatSuccess('Go to Vehicles in your profile.', rankedChunks, {});
    assert.equal(result.answer, 'Go to Vehicles in your profile.');
    assert.equal(result.sourceSection, 'Vehicles');
  });

  test('reports no source section when the answer came from a live action, even with chunks present', () => {
    const result = flatbrizSupportProfile.formatSuccess('You owe ₹2,450.', rankedChunks, { actionId: 'checkBillStatus' });
    assert.equal(result.sourceSection, null);
  });

  test('does not throw when rankedChunks is empty (the action-handler path passes [])', () => {
    const result = flatbrizSupportProfile.formatSuccess('You owe ₹2,450.', [], { actionId: 'checkBillStatus' });
    assert.equal(result.sourceSection, null);
    assert.equal(result.answer, 'You owe ₹2,450.');
  });

  test('an empty rankedChunks WITHOUT an actionId falls back to null via optional chaining, not a throw', () => {
    // Guards the historical audit finding that formatSuccess([]) is only
    // safe here because of the ?. — this pins that behavior down explicitly.
    const result = flatbrizSupportProfile.formatSuccess('some answer', [], {});
    assert.equal(result.sourceSection, null);
  });
});

describe('flatbrizSupportProfile.formatDegraded — LLM unreachable, manual excerpt fallback', () => {
  test('returns the top chunk verbatim when short enough, with its title as the source', () => {
    const rankedChunks = [{ chunk: { title: 'Vehicles', content: 'Short manual text.' } }];
    const result = flatbrizSupportProfile.formatDegraded(rankedChunks);
    assert.match(result.answer, /Short manual text\.$/);
    assert.match(result.answer, /"Vehicles"/);
    assert.equal(result.sourceSection, 'Vehicles');
  });

  test('truncates content over 700 characters with an ellipsis', () => {
    const longContent = 'x'.repeat(800);
    const rankedChunks = [{ chunk: { title: 'Long Section', content: longContent } }];
    const result = flatbrizSupportProfile.formatDegraded(rankedChunks);
    assert.ok(result.answer.includes('…'));
    // 700 x's plus the ellipsis character, not the full 800.
    const xCount = (result.answer.match(/x/g) || []).length;
    assert.equal(xCount, 700);
  });

  test('does not truncate content at exactly 700 characters', () => {
    const exactContent = 'y'.repeat(700);
    const rankedChunks = [{ chunk: { title: 'Exact Section', content: exactContent } }];
    const result = flatbrizSupportProfile.formatDegraded(rankedChunks);
    assert.ok(!result.answer.includes('…'));
  });
});
