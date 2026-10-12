const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, loadStack, createTenant, dropTenants, uid } = require('../support/realStack');

// Rules the DATABASE enforces on its own (unique indexes and CHECK
// constraints from the migrations), so a bug or a hand-written query can't
// break them either. Each one is attempted directly with Prisma.

describe('database constraints (real PostgreSQL)', { skip: skipReason }, () => {
  let prisma, t;
  before(async () => {
    ({ prisma } = loadStack());
    t = await createTenant(prisma, { name: 'Constraints' });
  });
  after(async () => {
    await dropTenants(prisma, [t]);
    await prisma?.$disconnect();
  });

  const rejects = (promise, pattern) => assert.rejects(promise, (e) => pattern.test(`${e.code || ''} ${e.message}`));

  test('one account per email: the same address twice is refused, in any letter case', async () => {
    await rejects(prisma.tenantUser.create({ data: { tenantId: t.tenant.id, email: t.email, passwordHash: 'x:y' } }), /P2002|Unique/);
    await rejects(prisma.tenantUser.create({ data: { tenantId: t.tenant.id, email: t.email.toUpperCase(), passwordHash: 'x:y' } }),
      /TenantUser_email_normalised_check/);
  });

  test('one self-serve company per signup email', async () => {
    const email = `${uid('signup')}@example.test`;
    const first = await prisma.tenant.create({ data: { name: 'S1', slug: uid('s1'), industryLabel: 'x', signupEmail: email } });
    try {
      await rejects(prisma.tenant.create({ data: { name: 'S2', slug: uid('s2'), industryLabel: 'x', signupEmail: email } }), /P2002|Unique/);
      // Staff-created companies have no signup email, and any number of them is fine.
      const staffMade = await Promise.all([1, 2].map((i) => prisma.tenant.create({ data: { name: `Staff ${i}`, slug: uid('st'), industryLabel: 'x' } })));
      await prisma.tenant.deleteMany({ where: { id: { in: staffMade.map((s) => s.id) } } });
    } finally {
      await prisma.tenant.delete({ where: { id: first.id } });
    }
  });

  test('bot types, ticket kinds, lead summary states and readiness scores are checked', async () => {
    await rejects(prisma.lead.create({ data: { tenantId: t.tenant.id, botType: 'marketing', email: 'a@b.test' } }), /Lead_botType_check/);
    await rejects(prisma.lead.create({ data: { tenantId: t.tenant.id, botType: 'sales', email: 'a@b.test', summaryStatus: 'maybe' } }), /Lead_summaryStatus_check/);
    await rejects(prisma.supportTicket.create({ data: { tenantId: t.tenant.id, query: 'q', transcript: [], kind: 'complaint' } }), /SupportTicket_kind_check/);
    await rejects(prisma.tenant.update({ where: { id: t.tenant.id }, data: { readinessScore: 140 } }), /Tenant_readinessScore_check/);
    await rejects(prisma.tenant.update({ where: { id: t.tenant.id }, data: { botPreference: 'all' } }), /Tenant_botPreference_check/);
    const session = await prisma.chatSession.create({ data: { tenantId: t.tenant.id } });
    await rejects(prisma.chatMessage.create({ data: { sessionId: session.id, role: 'user', content: 'x', botType: 'marketing' } }), /botType/);
  });

  test('API keys are unique by hash; an email verification row is unique by address', async () => {
    const key = await prisma.tenantApiKey.findFirst({ where: { tenantId: t.tenant.id } });
    await rejects(prisma.tenantApiKey.create({ data: { tenantId: t.tenant.id, keyHash: key.keyHash, keyPrefix: 'tk_x' } }), /P2002|Unique/);
    const email = `${uid('otp')}@example.test`;
    const row = { codeHash: 'h', expiresAt: new Date(Date.now() + 60000) };
    await prisma.emailVerification.create({ data: { email, ...row } });
    try {
      await rejects(prisma.emailVerification.create({ data: { email, ...row } }), /P2002|Unique/);
    } finally {
      await prisma.emailVerification.delete({ where: { email } });
    }
  });
});
