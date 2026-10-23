const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, tokenizeRaw, rankItems, scoreItem } = require('../../src/services/shared/lexicalSearch');

describe('lexicalSearch: tokenize/stemming', () => {
  test('stems inflected forms onto the same root', () => {
    assert.equal(tokenize('returns')[0], tokenize('return')[0]);
    assert.equal(tokenize('returned')[0], tokenize('return')[0]);
    assert.equal(tokenize('bills')[0], tokenize('bill')[0]);
    assert.equal(tokenize('visitors')[0], tokenize('visitor')[0]);
  });

  test('drops stopwords entirely (not just leaves them unstemmed)', () => {
    const tokens = tokenize('How do I pay my maintenance bill?');
    assert.ok(!tokens.includes('how'));
    assert.ok(!tokens.includes('do'));
    assert.ok(!tokens.includes('i'));
    assert.ok(!tokens.includes('my'));
    assert.ok(tokens.some((t) => t.startsWith('maint')));
  });

  test('tokenizeRaw preserves the literal (unstemmed) surface form', () => {
    assert.deepEqual(tokenizeRaw('Register your vehicles'), ['register', 'your', 'vehicles']);
  });

  test('tokenizeRaw literally includes "register", tokenize stems it away from "registered"', () => {
    const rawRegister = tokenizeRaw('register')[0];
    const rawRegistered = tokenizeRaw('registered')[0];
    assert.equal(rawRegister, 'register');
    assert.equal(rawRegistered, 'registered');
    assert.notEqual(rawRegister, rawRegistered, 'raw forms must stay distinct');
    assert.equal(tokenize('register')[0], tokenize('registered')[0], 'stems must collide (that is the point of stemming)');
  });
});

describe('lexicalSearch: rankItems — stemming-collision regression (Vehicles vs. Logging In)', () => {
  const items = [
    {
      title: 'Logging In',
      content:
        'Enter your registered mobile number on the login screen and request an OTP. Check that your ' +
        'registered phone number and email are correct under Profile.'
    },
    {
      title: 'Vehicles',
      content:
        'Register your vehicles (car/bike) with license plate numbers under Vehicles in your profile. ' +
        'This helps guards and admins verify parking access.'
    }
  ];

  test('a literal-word query ranks the exact-match section above a stem-only collision', () => {
    const ranked = rankItems('How do I register my car?', items, { minScore: 0 });
    assert.equal(ranked[0].item.title, 'Vehicles');
    assert.ok(
      ranked[0].score > ranked.find((r) => r.item.title === 'Logging In').score,
      'Vehicles must decisively outscore Logging In, not just tie'
    );
  });

  test('equal-score ties prefer the chunk with more literal (exact) matches, not file order', () => {
    // Two chunks engineered to tie on stemmed score alone ("register"/"registered"
    // both stem to "regist"), but differ on exact-match count. The stem-only
    // chunk deliberately comes FIRST in the array — mirroring the real bug,
    // where "Logging In" (stem-only collision) preceded "Vehicles" (exact
    // match) in the manual and won purely on file order before this fix.
    const tiedItems = [
      { title: 'First In File (stem-only)', content: 'registered registered' },
      { title: 'Second In File (exact match)', content: 'register register' }
    ];
    const ranked = rankItems('register', tiedItems, { minScore: 0, titleWeight: 0, bodyCapPerTerm: 2 });
    assert.equal(
      ranked[0].item.title,
      'Second In File (exact match)',
      'exact-match chunk should win the tie despite appearing later in the source order'
    );
  });

  test('boostTags heavily favor a tagged chunk when the query uses a mapped synonym', () => {
    const tagged = [
      { title: 'Vehicles', content: 'Register your vehicles under Vehicles in your profile.', tags: ['entity:vehicle'] },
      { title: 'Logging In', content: 'Enter your registered mobile number.', tags: [] }
    ];
    const withoutBoost = rankItems('How does parking access work?', tagged, { minScore: 0 });
    const withBoost = rankItems('How does parking access work?', tagged, {
      minScore: 0,
      boostTags: new Set(['entity:vehicle'])
    });
    const vehicleScoreBoosted = withBoost.find((r) => r.item.title === 'Vehicles').score;
    const vehicleScoreUnboosted = withoutBoost.find((r) => r.item.title === 'Vehicles')?.score || 0;
    assert.ok(vehicleScoreBoosted > vehicleScoreUnboosted, 'tag boost must add real score, not a no-op');
  });
});

describe('lexicalSearch: rankItems — general ranking behavior', () => {
  test('minScore filters out weak matches entirely', () => {
    const items = [{ title: 'Irrelevant', content: 'nothing related here at all' }];
    const ranked = rankItems('maintenance bill payment', items, { minScore: 2 });
    assert.equal(ranked.length, 0);
  });

  test('topK caps the number of returned candidates', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      title: `Section ${i}`,
      content: 'maintenance bill payment maintenance bill payment'
    }));
    const ranked = rankItems('maintenance bill payment', items, { minScore: 0, topK: 3 });
    assert.equal(ranked.length, 3);
  });

  test('an empty query returns no results rather than matching everything', () => {
    const items = [{ title: 'Anything', content: 'anything at all' }];
    assert.deepEqual(rankItems('', items, { minScore: 0 }), []);
    assert.deepEqual(rankItems('   ', items, { minScore: 0 }), []);
  });

  test('title matches are weighted more than an equivalent body-only match', () => {
    const items = [
      { title: 'Bill Payment Steps', content: 'unrelated filler content here' },
      { title: 'Unrelated Title', content: 'bill bill bill' }
    ];
    const ranked = rankItems('bill', items, { minScore: 0, titleWeight: 3, bodyCapPerTerm: 1 });
    const titleHit = ranked.find((r) => r.item.title === 'Bill Payment Steps').score;
    const bodyHit = ranked.find((r) => r.item.title === 'Unrelated Title').score;
    assert.equal(ranked[0].item.title, 'Bill Payment Steps');
    assert.ok(titleHit > bodyHit, 'title hit must decisively outscore a capped body-only match');
  });
});

describe('lexicalSearch: per-chunk index — scoring must be unchanged', () => {
  // Scoring used to tokenize and stem every chunk on every query; it now reads
  // a per-chunk index built once. These tests exist because that refactor must
  // be score-for-score invisible: engine/confidence.js derives its saturation
  // constant k from the per-term ceiling reached in scoreItem
  // ((titleWeight+exactBonus) + (bodyCapPerTerm+exactBonus) = 10), so any drift
  // here silently moves every tenant's 30% confidence gate without failing a
  // single existing assertion.
  //
  // Deliberately an INDEPENDENT implementation, written from the documented
  // rules rather than by calling the module, so it cannot drift along with it.
  function naiveScore(queryTerms, item, opts = {}) {
    const { titleWeight = 3, bodyCapPerTerm = 3, boostTags, tagBonus = 4, exactBonus = 2 } = opts;
    const titleRaw = tokenizeRaw(item.title);
    const titleStems = tokenize(item.title);
    const bodyRaw = tokenizeRaw(item.content);
    const bodyStems = tokenize(item.content);
    const occurrences = (list, term) => list.filter((t) => t === term).length;

    let score = 0;
    let exactMatches = 0;
    for (const { raw, stem, corrected } of queryTerms) {
      if (corrected) {
        // A typo-corrected term earns stem credit only, never the exact bonus.
        if (titleStems.includes(stem)) score += titleWeight;
        score += Math.min(occurrences(bodyStems, stem), bodyCapPerTerm);
        continue;
      }
      if (titleRaw.includes(raw)) {
        score += titleWeight + exactBonus;
        exactMatches += 1;
      } else if (titleStems.includes(stem)) {
        score += titleWeight;
      }
      score += Math.min(occurrences(bodyStems, stem), bodyCapPerTerm);
      if (occurrences(bodyRaw, raw) > 0) {
        score += exactBonus;
        exactMatches += 1;
      }
    }
    if (boostTags && boostTags.size && Array.isArray(item.tags)) {
      score += item.tags.filter((t) => boostTags.has(t)).length * tagBonus;
    }
    return { score, exactMatches };
  }

  const termsOf = (query) => tokenizeRaw(query).map((raw) => ({ raw, stem: tokenize(raw)[0] }));

  // One item per scoring branch.
  const ITEMS = [
    { title: 'Refund Policy', content: 'A refund is issued within 30 days of the refund request.', tags: ['benefit:fast_refunds'] },
    { title: 'Refunds And Returns', content: 'Returned items are inspected before a credit is raised.', tags: [] },
    { title: 'Unrelated Heading', content: 'refund refund refund refund refund refund', tags: [] },
    { title: 'Warranty', content: 'Coverage lasts twelve months from delivery.', tags: ['benefit:long_warranty', 'bot:support'] },
    { title: 'Empty', content: 'x', tags: undefined }
  ];

  const QUERIES = [
    'refund',                       // single term, exact in some titles and bodies
    'refunds',                      // stem-only against "refund"
    'how do I get a refund policy', // multi-term with stopwords dropped
    'returned items',               // body-only hits
    'warranty coverage delivery',   // title exact + body exact
    'nothing matches this at all'   // no hits anywhere
  ];

  const OPT_SETS = [
    {},
    { titleWeight: 0, bodyCapPerTerm: 2 },
    { exactBonus: 0 },
    { titleWeight: 5, bodyCapPerTerm: 10, exactBonus: 3 },
    { boostTags: new Set(['benefit:fast_refunds', 'benefit:long_warranty']) },
    { boostTags: new Set(['benefit:fast_refunds']), tagBonus: 7 }
  ];

  test('scoreItem matches an independent implementation across every item x query x options combination', () => {
    let compared = 0;
    for (const opts of OPT_SETS) {
      for (const query of QUERIES) {
        const terms = termsOf(query);
        for (const item of ITEMS) {
          const actual = scoreItem(terms, item, opts);
          const expected = naiveScore(terms, item, opts);
          assert.deepEqual(
            actual, expected,
            `score drift for "${query}" on "${item.title}" with ${JSON.stringify({ ...opts, boostTags: opts.boostTags && [...opts.boostTags] })}`
          );
          compared += 1;
        }
      }
    }
    assert.ok(compared >= 150, `expected a broad matrix, only compared ${compared} combinations`);
  });

  test('a typo-corrected term scores identically through the index (stem credit, no exact bonus)', () => {
    const terms = [{ raw: 'refund', stem: tokenize('refund')[0], corrected: 'refudn' }];
    for (const item of ITEMS) {
      assert.deepEqual(scoreItem(terms, item), naiveScore(terms, item), `drift on "${item.title}"`);
    }
  });

  test('the per-term ceiling is still 10, which is the k that engine/confidence.js assumes', () => {
    // One term exact-matching BOTH title and body: (3+2) + (3+2).
    const { score } = scoreItem(termsOf('refund'), { title: 'Refund', content: 'refund refund refund' });
    assert.equal(score, 10);
  });

  test("rankItems' rawScore is the unweighted score the independent implementation computes", () => {
    const terms = termsOf('refund policy');
    const ranked = rankItems('refund policy', ITEMS, { minScore: 0, topK: ITEMS.length, typoTolerance: false });
    assert.ok(ranked.length > 1);
    for (const { item, rawScore } of ranked) {
      assert.equal(rawScore, naiveScore(terms, item).score, `rawScore drift on "${item.title}"`);
    }
  });

  test('an itemWeight still only reorders: rawScore stays unweighted so the confidence gate cannot be moved by weighting', () => {
    const heavy = rankItems('refund', ITEMS, {
      minScore: 0, topK: ITEMS.length, typoTolerance: false, itemWeight: (i) => (i.title === 'Unrelated Heading' ? 10 : 1)
    });
    const plain = rankItems('refund', ITEMS, { minScore: 0, topK: ITEMS.length, typoTolerance: false });
    const rawOf = (list, title) => list.find((r) => r.item.title === title)?.rawScore;
    for (const { item } of plain) assert.equal(rawOf(heavy, item.title), rawOf(plain, item.title));
    assert.equal(heavy[0].item.title, 'Unrelated Heading', 'the weight should have reordered');
  });

  test('typo correction works when every call receives a freshly filtered array (the array-identity regression)', () => {
    // domains/tenantProfile.scopedTo used to .filter() per turn, handing
    // rankItems a brand-new array each time and defeating every cache keyed on
    // array identity. The chunks themselves are the same objects, so results
    // must be identical and stable call to call.
    const corpus = [
      { title: 'Protein', content: 'Our protein powder has 24g of protein per scoop.', tags: [] },
      { title: 'Shipping', content: 'Orders ship within two business days.', tags: [] }
    ];
    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const fresh = corpus.filter(() => true); // a new array, the same chunk objects
      assert.notEqual(fresh, corpus);
      const ranked = rankItems('protien powder', fresh, { minScore: 0 });
      assert.equal(ranked[0].item.title, 'Protein', 'typo correction must survive a fresh array');
      seen.add(ranked[0].rawScore);
    }
    assert.equal(seen.size, 1, `the same query scored differently across calls: ${[...seen].join(', ')}`);
  });

  test('a rebuilt chunk is scored on its new content', () => {
    // How an edit actually reaches retrieval: documentChunks() re-parses the
    // document and returns NEW chunk objects.
    const before = [{ title: 'Policy', content: 'Returns accepted within 30 days.', tags: [] }];
    const after = [{ title: 'Policy', content: 'Warranty covers twelve months.', tags: [] }];
    assert.equal(rankItems('warranty', before, { minScore: 1 }).length, 0);
    assert.ok(rankItems('warranty', after, { minScore: 1 }).length > 0);
  });

  test('CONTRACT: the index is keyed on the chunk object, so a chunk must be replaced, never edited in place', () => {
    // Pinning the invariant the cache depends on rather than asserting a
    // behaviour we want: domains/tenantProfile.documentChunks() always builds
    // new chunk objects and nothing edits one afterwards. If that ever changes,
    // this test fails and says why.
    const chunk = { title: 'Policy', content: 'Returns accepted within 30 days.', tags: [] };
    const items = [chunk];
    rankItems('returns', items, { minScore: 1 }); // builds and caches this chunk's index
    chunk.content = 'Warranty covers twelve months.'; // what no production code does
    assert.equal(
      rankItems('warranty', items, { minScore: 1 }).length, 0,
      'an in-place edit is intentionally NOT picked up — if chunks ever become mutable, ' +
      'the per-chunk index in lexicalSearch.js must be invalidated explicitly'
    );
  });
});
