// Wipes every tenant and everything that belongs to one — client accounts,
// documents, API keys, consents, chat history, tickets, usage — plus every
// operator account except HUB_ADMIN_EMAIL, leaving the schema and one KGT
// admin ready for production.
//
//   npm run db:reset -- --yes                  wipe, keep/create the admin
//   npm run db:reset -- --yes --with-showcase  ...then re-create Tenant #1 (FLATBRIZ)
//
// In Docker:  docker exec -it kgt-ai-hub-api npm run db:reset -- --yes
//
// Irreversible. Take a backup first:
//   docker exec kgt-ai-hub-postgres pg_dump -U kgthub kgthub > kgthub-backup.sql
// Note: the API seeds on every start (RUN_SEED=true), so set
// SEED_FLATBRIZ_TENANT=false in .env.docker if the showcase tenant should
// stay gone after the next restart.
require('dotenv').config();
const { seedOperator, seedFlatbrizTenant, prisma } = require('./seed');

const args = new Set(process.argv.slice(2));

function describeTarget() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL not set or unreadable)';
  }
}

async function counts() {
  const [tenants, users, documents, keys, sessions, tickets, operators] = await Promise.all([
    prisma.tenant.count(), prisma.tenantUser.count(), prisma.tenantDocument.count(), prisma.tenantApiKey.count(),
    prisma.chatSession.count(), prisma.supportTicket.count(), prisma.operator.count()
  ]);
  return { tenants, clientAccounts: users, documents, apiKeys: keys, chatSessions: sessions, tickets, operators };
}

async function main() {
  const adminEmail = String(process.env.HUB_ADMIN_EMAIL || '').trim().toLowerCase();
  console.log(`[reset] Target database: ${describeTarget()}`);
  console.log('[reset] Currently holds:', await counts());

  if (!args.has('--yes')) {
    console.log('[reset] Nothing deleted. Re-run with --yes to wipe all tenant data (irreversible).');
    return;
  }
  if (process.env.DEPLOY_ENV === 'production' && !args.has('--i-understand-this-is-production')) {
    console.error('[reset] DEPLOY_ENV=production — refusing. Add --i-understand-this-is-production if you really mean it.');
    process.exitCode = 1;
    return;
  }
  if (!adminEmail) {
    console.error('[reset] HUB_ADMIN_EMAIL is not set — refusing, or no one could sign in afterwards.');
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    // CASCADE reaches every table with a foreign key to Tenant (client
    // accounts, documents, keys, consents, sessions -> messages, tickets, usage).
    await tx.$executeRawUnsafe('TRUNCATE TABLE "Tenant" CASCADE');
    await tx.operator.deleteMany({ where: { email: { not: adminEmail } } });
  });
  console.log('[reset] All tenants and their data deleted; operators other than', adminEmail, 'removed.');

  await seedOperator(); // creates the admin if it didn't exist; never changes an existing one's password
  if (args.has('--with-showcase')) await seedFlatbrizTenant();

  console.log('[reset] Now holds:', await counts());
}

main()
  .catch((err) => {
    console.error('[reset] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
