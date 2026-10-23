const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, loadStack, createTenant, dropTenants } = require('../support/realStack');

// The session-summary claim against a REAL database
// (services/chatSessions.claimSessionsToSummarize).
//
// Why this layer: the claim's whole purpose is that two API instances sweeping
// at the same moment never both pick up the same conversation, because each
// summary is a paid LLM call. That is a property of Postgres row locking
// (UPDATE over a FOR UPDATE SKIP LOCKED subquery), so a mocked Prisma cannot
// demonstrate it — the previous test asserted on the SQL *string*, which would
// not have caught the missing claim at all. Concurrency here means several
// statements in flight against one database, which is exactly what N
// containers do.

describe('session summary claim (real PostgreSQL)', { skip: skipReason }, () => {
  let prisma, chatSessions, tenant;

  before(async () => {
    prisma = loadStack().prisma;
    // A short lease, so takeover can be tested without waiting minutes.
    process.env.SESSION_SUMMARY_LEASE_MIN = '0.05'; // 3 seconds
    chatSessions = require('../../src/services/chatSessions');
    tenant = await createTenant(prisma, { name: 'ClaimCo' });
  });

  after(async () => {
    delete process.env.SESSION_SUMMARY_LEASE_MIN;
    await dropTenants(prisma, [tenant]);
    await prisma?.$disconnect();
  });

  // Idle long enough for the sweep, recent enough to be inside the lookback.
  const IDLE = () => new Date(Date.now() - 10 * 60 * 1000);

  async function addSessions(n, over = {}) {
    const made = [];
    for (let i = 0; i < n; i++) {
      made.push(await prisma.chatSession.create({
        data: {
          tenantId: tenant.tenant.id, botType: 'support', messageCount: 4,
          lastMessageAt: IDLE(), summaryStatus: 'none', ...over
        }
      }));
    }
    return made;
  }

  beforeEach(async () => {
    await prisma.chatSession.deleteMany({ where: { tenantId: tenant.tenant.id } });
  });

  test('THE POINT: two sweeps running at once split the work — every conversation claimed exactly once', async () => {
    const made = await addSessions(12);

    // Both statements in flight together, as two containers would be.
    const [first, second] = await Promise.all([
      chatSessions.claimSessionsToSummarize({ limit: 12 }),
      chatSessions.claimSessionsToSummarize({ limit: 12 })
    ]);

    const overlap = first.filter((id) => second.includes(id));
    assert.deepEqual(overlap, [], `the same conversation was handed to both sweeps: ${overlap.join(', ')}`);

    const claimed = [...first, ...second].sort();
    assert.deepEqual(claimed, made.map((s) => s.id).sort(), 'every conversation should be claimed, and none twice');
  });

  test('a claimed conversation is marked pending with a claim timestamp', async () => {
    const [session] = await addSessions(1);
    assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), [session.id]);

    const after = await prisma.chatSession.findUnique({ where: { id: session.id } });
    assert.equal(after.summaryStatus, 'pending');
    assert.ok(after.summaryClaimedAt instanceof Date);
  });

  test('a live claim is not handed out again', async () => {
    await addSessions(3);
    const firstPass = await chatSessions.claimSessionsToSummarize({ limit: 3 });
    assert.equal(firstPass.length, 3);
    assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 3 }), [], 'held leases must be skipped');
  });

  test('an expired lease is taken over, so a container killed mid-summary does not park a conversation for ever', async () => {
    const [session] = await addSessions(1);
    assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), [session.id]);
    assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), []);

    await new Promise((resolve) => setTimeout(resolve, 3200)); // the 3s lease lapses
    assert.deepEqual(
      await chatSessions.claimSessionsToSummarize({ limit: 5 }), [session.id],
      'a conversation whose holder died must become claimable again'
    );
  });

  test('limit bounds one sweep, which is what keeps a backlog from becoming a burst of model calls', async () => {
    await addSessions(8);
    assert.equal((await chatSessions.claimSessionsToSummarize({ limit: 3 })).length, 3);
  });

  test('oldest activity is claimed first', async () => {
    const old = await prisma.chatSession.create({
      data: { tenantId: tenant.tenant.id, botType: 'support', messageCount: 2, lastMessageAt: new Date(Date.now() - 60 * 60 * 1000) }
    });
    await addSessions(1); // more recent
    assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 1 }), [old.id]);
  });

  describe('what the sweep must never pick up', () => {
    test('a conversation too short to be worth a summary', async () => {
      await addSessions(1, { messageCount: 1 });
      assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), []);
    });

    test('a conversation still being chatted in (not yet idle)', async () => {
      await addSessions(1, { lastMessageAt: new Date() });
      assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), []);
    });

    test('a conversation whose summary is already current', async () => {
      const when = IDLE();
      await addSessions(1, { lastMessageAt: when, summarizedAt: new Date(when.getTime() + 1000), summaryStatus: 'ready' });
      assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), []);
    });

    test('a conversation that carried on after its summary IS picked up again', async () => {
      const when = IDLE();
      const [session] = await addSessions(1, {
        lastMessageAt: when, summarizedAt: new Date(when.getTime() - 1000), summaryStatus: 'ready'
      });
      assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), [session.id]);
    });

    test('a conversation older than the lookback window', async () => {
      await addSessions(1, { lastMessageAt: new Date(Date.now() - 72 * 60 * 60 * 1000) });
      assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), []);
    });

    test("a deactivated company's conversation", async () => {
      await addSessions(1);
      await prisma.tenant.update({ where: { id: tenant.tenant.id }, data: { active: false } });
      try {
        assert.deepEqual(await chatSessions.claimSessionsToSummarize({ limit: 5 }), []);
      } finally {
        await prisma.tenant.update({ where: { id: tenant.tenant.id }, data: { active: true } });
      }
    });
  });

  describe('claimSession (one conversation, by id)', () => {
    test('claims an unheld conversation and refuses a held one', async () => {
      const [session] = await addSessions(1);
      assert.equal(await chatSessions.claimSession(session.id), true);
      assert.equal(await chatSessions.claimSession(session.id), false, 'a live lease must be respected');
    });

    test('force takes a held claim — the dashboard Rewrite button', async () => {
      const [session] = await addSessions(1);
      assert.equal(await chatSessions.claimSession(session.id), true);
      assert.equal(await chatSessions.claimSession(session.id, { force: true }), true);
    });

    test('an unknown id claims nothing', async () => {
      assert.equal(await chatSessions.claimSession('00000000-0000-0000-0000-000000000000'), false);
    });
  });
});
