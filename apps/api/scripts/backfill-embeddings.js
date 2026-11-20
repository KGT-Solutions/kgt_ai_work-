#!/usr/bin/env node
// Backfills the semantic index (DocumentChunk rows + embeddings) for tenants
// that existed before hybrid search, or whose embeddings are missing because the
// provider was unreachable at write time.
//
//   node scripts/backfill-embeddings.js            every tenant
//   node scripts/backfill-embeddings.js <tenantId> one tenant
//   npm run embeddings:backfill
//
// In Docker:  docker exec kgt-ai-hub-api npm run embeddings:backfill
//
// Idempotent and resumable: syncTenantChunks re-embeds only chunks whose text
// changed or that aren't yet embedded at the current model, so re-running is
// cheap and safe. Requires OPENAI_API_KEY (EMBEDDING_MODEL optional); without a
// key it still creates the rows but leaves embeddings null, and search stays
// lexical-only until a key is set and this is re-run.
require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { syncTenantChunks } = require('../src/services/shared/chunkStore');
const { isEmbeddingConfigured } = require('../src/services/shared/embeddings');

async function main() {
  const onlyTenant = process.argv[2];
  if (!isEmbeddingConfigured()) {
    console.warn('[backfill] OPENAI_API_KEY is not set — rows will be created without embeddings (lexical-only).');
  }

  const tenants = onlyTenant
    ? await prisma.tenant.findMany({ where: { id: onlyTenant }, select: { id: true, slug: true } })
    : await prisma.tenant.findMany({ select: { id: true, slug: true }, orderBy: { createdAt: 'asc' } });

  if (!tenants.length) {
    console.error(onlyTenant ? `[backfill] no tenant with id ${onlyTenant}` : '[backfill] no tenants found');
    return;
  }

  let totalEmbedded = 0;
  for (const t of tenants) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await syncTenantChunks(t.id);
      totalEmbedded += r.embedded;
      console.log(`[backfill] ${t.slug}: synced ${r.synced}, embedded ${r.embedded}, deleted ${r.deleted}`);
    } catch (err) {
      console.error(`[backfill] ${t.slug}: FAILED — ${err.message}`);
    }
  }
  console.log(`[backfill] done: ${totalEmbedded} chunk(s) embedded across ${tenants.length} tenant(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
