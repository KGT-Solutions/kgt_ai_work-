const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// leadCapture.js is destructured by flatbrizSales.profile.js at require time
// (`const { captureLead } = require('../services/salesbot/leadCapture')`),
// so it must be mocked BEFORE the profile is first required here.
const leadCapture = require('../src/services/salesbot/leadCapture');
const captureLeadMock = require('node:test').mock.method(leadCapture, 'captureLead', async () => ({ logged: true, alerted: false }));
const { flatbrizSalesProfile, OUT_OF_SCOPE_MESSAGE } = require('../src/domains/flatbrizSales.profile');

describe('flatbrizSalesProfile.systemPrompt — persona, objections, and competitor handling', () => {
  test('addresses each clientType with its own label', () => {
    assert.match(
      flatbrizSalesProfile.systemPrompt({ clientType: 'builder', classification: {} }),
      /talking to a builder\/developer/
    );
    assert.match(
      flatbrizSalesProfile.systemPrompt({ clientType: 'rwa_president', classification: {} }),
      /talking to an RWA \(Resident Welfare Association\) president/
    );
    assert.match(
      flatbrizSalesProfile.systemPrompt({ clientType: 'committee_member', classification: {} }),
      /talking to a managing committee member/
    );
  });

  test('falls back to a generic prospect label for an unknown clientType', () => {
    assert.match(
      flatbrizSalesProfile.systemPrompt({ clientType: 'nonsense', classification: {} }),
      /talking to a prospective FLATBRIZ client/
    );
  });

  test('embeds the sales sentinel, distinct from the support bot\'s', () => {
    const prompt = flatbrizSalesProfile.systemPrompt({ clientType: 'builder', classification: {} });
    assert.match(prompt, /NO_ANSWER_IN_KB/);
    assert.equal(flatbrizSalesProfile.noAnswerSentinel, 'NO_ANSWER_IN_KB');
  });

  test('adds an explicit objection-handling instruction only when objectionTags are present', () => {
    const withObjection = flatbrizSalesProfile.systemPrompt({
      clientType: 'builder',
      classification: { objectionTags: ['objection:pricing'] }
    });
    assert.match(withObjection, /raises an objection \(objection:pricing\)/);

    const without = flatbrizSalesProfile.systemPrompt({ clientType: 'builder', classification: {} });
    assert.doesNotMatch(without, /raises an objection/);
  });

  test('adds an explicit competitor-comparison instruction only when competitorTags are present', () => {
    const withCompetitor = flatbrizSalesProfile.systemPrompt({
      clientType: 'builder',
      classification: { competitorTags: ['competitor:mygate'] }
    });
    assert.match(withCompetitor, /mentioned a competitor \(competitor:mygate\)/);
    assert.match(withCompetitor, /never disparage the competitor personally/);
  });

  test('instructs the model never to fabricate a meeting time or discount', () => {
    const prompt = flatbrizSalesProfile.systemPrompt({ clientType: 'builder', classification: {} });
    // The source line-wraps mid-phrase ("...but do\n   not fabricate..."),
    // so match tolerant of any whitespace (including the newline) between words.
    assert.match(prompt, /do\s+not\s+fabricate\s+a\s+specific\s+meeting\s+time\s+or\s+discount/);
  });
});

describe('flatbrizSalesProfile.boostTags — objection/competitor/clientType tag boosting', () => {
  test('combines objection tags, competitor tags, and a client:<type> tag', () => {
    const tags = flatbrizSalesProfile.boostTags({
      clientType: 'builder',
      classification: { objectionTags: ['objection:pricing'], competitorTags: ['competitor:mygate'] }
    });
    assert.ok(tags.has('objection:pricing'));
    assert.ok(tags.has('competitor:mygate'));
    assert.ok(tags.has('client:builder'));
  });

  test('still includes the client tag even with no classification at all', () => {
    const tags = flatbrizSalesProfile.boostTags({ clientType: 'rwa_president' });
    assert.deepEqual([...tags], ['client:rwa_president']);
  });
});

describe('flatbrizSalesProfile.formatFallback / formatSuccess / formatDegraded — response shape', () => {
  const ctx = { clientType: 'builder', classification: { objectionTags: [], buyingSignals: ['demo'] } };
  const rankedChunks = [{
    chunk: {
      title: 'Zero Gateway Commission',
      content: 'FLATBRIZ charges no commission on UPI-collected maintenance payments.',
      tags: ['benefit:zero_gateway_commission']
    }
  }];

  test('formatFallback returns the out-of-scope message with no benefits and a computed follow-up', () => {
    const result = flatbrizSalesProfile.formatFallback(ctx);
    assert.equal(result.answer, OUT_OF_SCOPE_MESSAGE);
    assert.deepEqual(result.keyBenefitsHighlighted, []);
    assert.equal(result.suggestedFollowUp, 'Would you like to schedule a short call or live demo with our team?');
  });

  test('formatSuccess passes the answer through and derives benefits + follow-up from ctx/chunks', () => {
    const result = flatbrizSalesProfile.formatSuccess('FLATBRIZ charges zero gateway commission.', rankedChunks, ctx);
    assert.equal(result.answer, 'FLATBRIZ charges zero gateway commission.');
    assert.deepEqual(result.keyBenefitsHighlighted, ['Zero payment gateway commission on maintenance collections']);
    assert.equal(result.suggestedFollowUp, 'Would you like to schedule a short call or live demo with our team?');
  });

  test('formatDegraded is marked degraded:true and still surfaces benefits from the top chunk', () => {
    const result = flatbrizSalesProfile.formatDegraded(rankedChunks, ctx);
    assert.equal(result.degraded, true);
    assert.match(result.answer, /Zero Gateway Commission/);
    assert.deepEqual(result.keyBenefitsHighlighted, ['Zero payment gateway commission on maintenance collections']);
  });
});

describe('flatbrizSalesProfile.onResult — lead capture is invoked unconditionally', () => {
  beforeEach(() => {
    captureLeadMock.mock.resetCalls();
  });

  test('captures a lead with the merged signal list (objections + competitors + buying signals)', async () => {
    const ctx = {
      clientType: 'builder',
      classification: {
        objectionTags: ['objection:pricing'],
        competitorTags: ['competitor:mygate'],
        buyingSignals: ['demo'],
        intentScore: 55,
        isHighIntent: true
      }
    };
    const result = { answer: 'Here is our pricing...' };
    await flatbrizSalesProfile.onResult(result, 'is this cheaper than mygate', ctx);

    assert.equal(captureLeadMock.mock.callCount(), 1);
    const call = captureLeadMock.mock.calls[0].arguments[0];
    assert.equal(call.clientType, 'builder');
    assert.equal(call.query, 'is this cheaper than mygate');
    assert.equal(call.answer, 'Here is our pricing...');
    assert.equal(call.intentScore, 55);
    assert.equal(call.isHighIntent, true);
    assert.deepEqual(call.signals, ['objection:pricing', 'competitor:mygate', 'demo']);
  });

  test('still calls captureLead even on a fallback/out-of-scope result — every inquiry is logged', async () => {
    const ctx = { clientType: 'builder', classification: {} };
    await flatbrizSalesProfile.onResult({ answer: OUT_OF_SCOPE_MESSAGE }, 'random unrelated question', ctx);
    assert.equal(captureLeadMock.mock.callCount(), 1);
    assert.deepEqual(captureLeadMock.mock.calls[0].arguments[0].signals, []);
  });

  test('defaults intentScore to 0 and isHighIntent to false when classification is missing entirely', async () => {
    await flatbrizSalesProfile.onResult({ answer: 'a' }, 'q', { clientType: 'builder' });
    const call = captureLeadMock.mock.calls[0].arguments[0];
    assert.equal(call.intentScore, 0);
    assert.equal(call.isHighIntent, false);
  });
});
