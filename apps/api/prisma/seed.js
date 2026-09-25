require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../src/utils/password');
const { issueApiKey, hashApiKey, keyPrefix } = require('../src/utils/tenantApiKeys');

const prisma = new PrismaClient();

// Idempotent: safe to run on every container start (RUN_SEED=true).
//
// 1. The first operator account, from HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD.
//    Never hardcoded — this repo is public. An existing operator's password
//    is left alone; change it in the database, not by re-seeding.
// 2. The showcase tenant, Flatbriz (Tenant #1), unless SEED_FLATBRIZ_TENANT=false:
//    its knowledge base comes from prisma/seed-data/flatbriz/*.md and is only
//    written when the tenant is first created, so later edits made in the
//    operator console are never overwritten.
//    API key: set FLATBRIZ_TENANT_API_KEY to pin a stable key for the
//    Flatbriz embed (stored hashed, survives restarts and redeploys);
//    otherwise a random key is issued on first creation and printed once.

const FLATBRIZ_SLUG = 'flatbriz';
const SEED_DIR = path.join(__dirname, 'seed-data', 'flatbriz');

// file -> how the tenant's bots should treat it (see services/shared/documentCategory.js)
const FLATBRIZ_DOCS = [
  { file: 'resident-manual.md', title: 'Resident & Guard Guide', category: 'FAQ' },
  { file: 'admin-manual.md', title: 'Building Admin & Committee Guide', category: 'FAQ' },
  { file: 'value-propositions.md', title: 'Why Societies Choose FLATBRIZ', category: 'CORE_OVERVIEW' },
  { file: 'client-playbooks.md', title: 'FLATBRIZ for Builders, RWA Presidents and Committees', category: 'CORE_OVERVIEW' },
  { file: 'competitor-comparison.md', title: 'FLATBRIZ vs. MyGate and NoBroker', category: 'CORE_OVERVIEW' },
  { file: 'financial-ledger.md', title: 'Billing, Ledger and Late-Fee Rules', category: 'CUSTOM_POLICY' }
];

// A key an operator pins by hand still has to be unguessable.
const PINNED_KEY_FORMAT = /^tk_[A-Za-z0-9_-]{32,}$/;

async function seedOperator() {
  const email = String(process.env.HUB_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.HUB_ADMIN_PASSWORD || '');
  if (!email || !password) {
    console.log('[seed] HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD not set — skipping operator account.');
    return;
  }
  if (password.length < 10) throw new Error('HUB_ADMIN_PASSWORD must be at least 10 characters');

  const existing = await prisma.operator.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] Operator ${email} already exists — left unchanged.`);
    return;
  }
  await prisma.operator.create({
    data: { email, name: process.env.HUB_ADMIN_NAME || 'Platform admin', passwordHash: hashPassword(password) }
  });
  console.log(`[seed] Created operator ${email}.`);
}

function pinnedFlatbrizKey() {
  const key = String(process.env.FLATBRIZ_TENANT_API_KEY || '').trim();
  if (!key) return null;
  if (!PINNED_KEY_FORMAT.test(key)) {
    throw new Error('FLATBRIZ_TENANT_API_KEY must look like tk_ followed by at least 32 letters/digits (e.g. tk_$(openssl rand -hex 24))');
  }
  return key;
}

async function seedFlatbrizTenant() {
  if (process.env.SEED_FLATBRIZ_TENANT === 'false') return;
  const pinnedKey = pinnedFlatbrizKey();

  let tenant = await prisma.tenant.findUnique({ where: { slug: FLATBRIZ_SLUG } });
  let issuedKey = null;

  if (!tenant) {
    const docs = FLATBRIZ_DOCS.map((d) => ({
      title: d.title,
      category: d.category,
      content: fs.readFileSync(path.join(SEED_DIR, d.file), 'utf8').trim()
    }));
    tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: 'FLATBRIZ',
          slug: FLATBRIZ_SLUG,
          industryLabel: 'Real Estate & Housing — society management software',
          persona:
            'You speak for FLATBRIZ, a society management app used by residents, guards, building ' +
            'admins and committee members, and evaluated by builders and RWA presidents.'
        }
      });
      await tx.tenantDocument.createMany({ data: docs.map((d) => ({ ...d, tenantId: created.id })) });
      if (!pinnedKey) issuedKey = (await issueApiKey(tx, created.id, 'Primary')).key;
      return created;
    });
    console.log(`[seed] Created tenant ${FLATBRIZ_SLUG} (Tenant #1) with ${docs.length} documents.`);
  } else {
    console.log(`[seed] Tenant ${FLATBRIZ_SLUG} already exists — documents left unchanged.`);
  }

  if (pinnedKey) {
    const keyHash = hashApiKey(pinnedKey);
    const existing = await prisma.tenantApiKey.findUnique({ where: { keyHash } });
    if (existing && existing.tenantId !== tenant.id) {
      throw new Error('FLATBRIZ_TENANT_API_KEY is already in use by another tenant — choose a different key');
    }
    if (!existing) {
      await prisma.tenantApiKey.create({
        data: { tenantId: tenant.id, keyHash, keyPrefix: keyPrefix(pinnedKey), label: 'Primary (FLATBRIZ_TENANT_API_KEY)' }
      });
      console.log(`[seed] Registered the pinned key ${keyPrefix(pinnedKey)}… for ${FLATBRIZ_SLUG}.`);
    } else if (existing.revokedAt) {
      console.warn(`[seed] WARNING: the pinned key ${keyPrefix(pinnedKey)}… was revoked in the console; the Flatbriz widget won't work until FLATBRIZ_TENANT_API_KEY is changed.`);
    }
  } else if (issuedKey) {
    console.log(`[seed] ${FLATBRIZ_SLUG} API key (shown once — put it in the Flatbriz embed): ${issuedKey}`);
  }
}

async function main() {
  await seedOperator();
  await seedFlatbrizTenant();
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
