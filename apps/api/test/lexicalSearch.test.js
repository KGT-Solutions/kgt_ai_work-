const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, tokenizeRaw, rankItems } = require('../src/services/shared/lexicalSearch');

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
