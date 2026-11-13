const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const branding = require('../../src/services/branding');

// Logo storage atomicity (adversarial review, Major). The logo image used to
// be overwritten BEFORE the branding row recorded its new key, outside any
// transaction: a failed save left the live key without its image (the widget
// showed a broken logo), and an upload racing a remove could delete the image
// the winner pointed at. Now: content-keyed rows, inserted beside the old one,
// switched and purged in ONE transaction under the tenant's row lock.
//
// The database double below behaves like Postgres for what matters here:
// a transaction works on its own copy and commits it all or nothing; the row
// lock ($executeRaw … FOR UPDATE) serializes writers and, once acquired, sees
// everything committed before it; uncommitted rows are invisible to others.

function transactionalDb() {
  const db = { branding: null, assets: new Map() };
  const hooks = { failNextBrandingWrite: false, beforeBrandingWrite: null };
  let lock = Promise.resolve();

  const pick = (a, select) => (a ? (select ? Object.fromEntries(Object.keys(select).map((f) => [f, a[f]])) : a) : null);
  const delegates = (view) => ({
    tenantBranding: {
      findUnique: async () => view.branding,
      upsert: async ({ create, update }) => {
        if (hooks.beforeBrandingWrite) await hooks.beforeBrandingWrite();
        if (hooks.failNextBrandingWrite) { hooks.failNextBrandingWrite = false; throw new Error('connection reset (simulated)'); }
        view.branding = view.branding ? { ...view.branding, ...update } : { id: 'b1', ...create };
        return view.branding;
      },
      update: async ({ data }) => { view.branding = { ...view.branding, ...data }; return view.branding; }
    },
    tenantLogoAsset: {
      findFirst: async ({ where, select }) => pick([...view.assets.values()].find((a) => a.tenantId === where.tenantId &&
        where.OR.some((c) => (c.key !== undefined && a.key === c.key) || (c.reversedKey !== undefined && a.reversedKey === c.reversedKey))), select),
      findUnique: async ({ where, select }) => pick(view.assets.get(where.tenantId_key.key), select),
      upsert: async ({ where, create }) => {
        if (!view.assets.has(where.tenantId_key.key)) view.assets.set(where.tenantId_key.key, { ...create });
        return view.assets.get(where.tenantId_key.key);
      },
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const k of [...view.assets.keys()]) if (!where.key || k !== where.key.not) { view.assets.delete(k); count += 1; }
        return { count };
      }
    },
    tenantConsent: { findFirst: async () => null }
  });

  const prisma = {
    ...delegates(db), // outside a transaction: committed state
    async $transaction(fn) {
      let release = () => {};
      const work = { branding: db.branding, assets: new Map(db.assets) };
      const tx = {
        ...delegates(work),
        $executeRaw: async () => {
          const previous = lock;
          lock = new Promise((resolve) => { release = resolve; });
          await previous;
          // Holding the lock: see everything committed before it.
          work.branding = db.branding;
          work.assets = new Map(db.assets);
          return 1;
        }
      };
      try {
        const result = await fn(tx);
        db.branding = work.branding; // commit
        db.assets = work.assets;
        return result;
      } finally {
        release();
      }
    }
  };
  return { prisma, db, hooks };
}

const TENANT = { id: 't1', name: 'Acme' };
const png = (color) => sharp({ create: { width: 120, height: 60, channels: 4, background: color } }).png().toBuffer();
const keyOf = (view) => view.logoUrl.split('/').pop().replace('.png', '');

// The invariant: the live key has its image, and no other image rows linger.
function assertConsistent(db) {
  const live = db.branding?.customLogoKey || null;
  if (live) {
    assert.ok(db.assets.has(live), `live key ${live} has its image row`);
    assert.deepEqual([...db.assets.keys()], [live], 'no orphaned image rows');
  } else {
    assert.equal(db.assets.size, 0, 'no logo, no image rows');
  }
}

describe('logo storage is atomic', () => {
  test('a save that fails after the image insert rolls back entirely: the old logo stays live', async () => {
    const { prisma, db, hooks } = transactionalDb();
    const first = await branding.uploadLogo(TENANT, await png('#1d4ed8'), { prisma });
    hooks.failNextBrandingWrite = true;
    await assert.rejects(branding.uploadLogo(TENANT, await png('#dc2626'), { prisma }), /connection reset/);
    assert.equal(db.branding.customLogoKey, keyOf(first), 'the branding row still points at the first logo');
    assert.ok(await branding.getLogoAsset('t1', keyOf(first), { prisma }), 'and the first logo still resolves');
    assertConsistent(db);
  });

  test('a failed remove keeps the logo and its image', async () => {
    const { prisma, db, hooks } = transactionalDb();
    const first = await branding.uploadLogo(TENANT, await png('#1d4ed8'), { prisma });
    hooks.failNextBrandingWrite = true;
    await assert.rejects(branding.removeLogo(TENANT, { prisma }));
    assert.ok(await branding.getLogoAsset('t1', keyOf(first), { prisma }));
    assertConsistent(db);
  });

  test('an upload racing a remove ends consistent, in every interleaving', async () => {
    for (const delay of [0, 5, 15, 30]) {
      const { prisma, db, hooks } = transactionalDb();
      await branding.uploadLogo(TENANT, await png('#1d4ed8'), { prisma });
      let n = 0;
      hooks.beforeBrandingWrite = () => new Promise((r) => setTimeout(r, (n++ % 2 ? delay : 30 - delay)));
      const newer = await png('#16a34a');
      await Promise.all([branding.removeLogo(TENANT, { prisma }), branding.uploadLogo(TENANT, newer, { prisma })]);
      hooks.beforeBrandingWrite = null;
      assertConsistent(db);
    }
  });

  test('two uploads at once: the last committed wins, with its image intact and nothing orphaned', async () => {
    const { prisma, db, hooks } = transactionalDb();
    await branding.uploadLogo(TENANT, await png('#1d4ed8'), { prisma });
    hooks.beforeBrandingWrite = () => new Promise((r) => setTimeout(r, 10));
    const [a, b] = await Promise.all([
      branding.uploadLogo(TENANT, await png('#dc2626'), { prisma }),
      branding.uploadLogo(TENANT, await png('#16a34a'), { prisma })
    ]);
    hooks.beforeBrandingWrite = null;
    assertConsistent(db);
    assert.ok([keyOf(a), keyOf(b)].includes(db.branding.customLogoKey));
    assert.ok(await branding.getLogoAsset('t1', db.branding.customLogoKey, { prisma }));
  });

  test('a colour-only save keeps the hosted logo and its image (the purge spares the live row)', async () => {
    const { prisma, db } = transactionalDb();
    const up = await branding.uploadLogo(TENANT, await png('#1d4ed8'), { prisma });
    await branding.updateBrandKit(TENANT, { primaryColor: '#0d9488' }, { prisma, analyzeLogo: async () => null, cleanLogo: async () => null });
    assert.equal(db.branding.customLogoKey, keyOf(up));
    assertConsistent(db);
  });

  test('re-uploading the identical image is a no-op for storage (same content key, one row)', async () => {
    const { prisma, db } = transactionalDb();
    const img = await png('#1d4ed8');
    const a = await branding.uploadLogo(TENANT, img, { prisma });
    const b = await branding.uploadLogo(TENANT, img, { prisma });
    assert.equal(keyOf(a), keyOf(b));
    assertConsistent(db);
  });
});
