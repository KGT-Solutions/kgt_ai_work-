const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Requiring this action registers it as a side effect (via registerAction),
// and requiring it pulls in ../lib/prisma (instantiates PrismaClient — safe
// without a live DB connection since we only exercise match(), never run()).
require('../src/actions/checkBillStatus');
const { getAction } = require('../src/engine/actionRegistry');

const checkBillStatus = getAction('checkBillStatus');
const ctx = { buildingId: 'b1', userId: 'u1' };

describe('checkBillStatus.match — procedural ("how to pay") vs. balance ("what do I owe") intent', () => {
  const proceduralQueries = [
    'How do I pay my maintenance bill?',
    'how to pay my dues',
    'Where can I pay my maintenance?',
    'How do I upload my payment?',
    'How do I confirm my payment?'
  ];

  const balanceQueries = [
    'How much do I owe right now?',
    'what do I owe this month',
    'Do I have any outstanding dues?',
    'Is my maintenance bill paid or pending?',
    'What is my bill status?'
  ];

  for (const q of proceduralQueries) {
    test(`does NOT trigger on procedural query: "${q}"`, () => {
      assert.equal(checkBillStatus.match(q, ctx), false);
    });
  }

  for (const q of balanceQueries) {
    test(`DOES trigger on balance query: "${q}"`, () => {
      assert.equal(checkBillStatus.match(q, ctx), true);
    });
  }

  test('exclusion wins even when a balance pattern also independently matches the same query', () => {
    // "outstanding bill" alone matches BALANCE_TRIGGER_PATTERNS'
    // /outstanding (bill|...)/, and "how do i pay" independently matches a
    // PROCEDURAL_EXCLUSIONS entry — this query trips both, and the
    // exclusion must still win since it's checked first.
    assert.equal(checkBillStatus.match('How do I pay my outstanding bill?', ctx), false);
  });

  test('an unrelated question triggers neither exclusion nor balance pattern', () => {
    assert.equal(checkBillStatus.match('How do I book the clubhouse?', ctx), false);
  });
});

describe('checkBillStatus.match — context requirements', () => {
  test('never triggers without a buildingId, even for an otherwise-valid balance query', () => {
    assert.equal(checkBillStatus.match('How much do I owe right now?', { userId: 'u1' }), false);
  });

  test('never triggers without a userId, even for an otherwise-valid balance query', () => {
    assert.equal(checkBillStatus.match('How much do I owe right now?', { buildingId: 'b1' }), false);
  });

  test('never triggers with neither buildingId nor userId', () => {
    assert.equal(checkBillStatus.match('How much do I owe right now?', {}), false);
  });
});
