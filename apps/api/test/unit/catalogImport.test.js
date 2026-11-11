const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../../src/lib/prisma');
const { importExtractedProducts, addProduct, listProducts } = require('../../src/services/catalogIngest');

// In-memory stand-in for Postgres, shared between the $transaction body and the
// top-level reads. findFirst resolves by id OR by (tenantId, sku) — the latter
// is how importExtractedProducts matches an existing row to upsert.
let state; let realTx; let realPc; let realTd;

function makeDelegates() {
  const pc = {
    findMany: async ({ where }) => state.products.filter((r) => r.tenantId === where.tenantId),
    count: async ({ where }) => state.products.filter((r) => r.tenantId === where.tenantId).length,
    findFirst: async ({ where }) => state.products.find((r) =>
      (where.id ? r.id === where.id : true) &&
      (where.tenantId ? r.tenantId === where.tenantId : true) &&
      (where.sku ? r.sku === where.sku : true)) || null,
    create: async ({ data }) => { const r = { id: `p${++state.seq}`, ...data }; state.products.push(r); return r; },
    update: async ({ where, data }) => { const r = state.products.find((x) => x.id === where.id); Object.assign(r, data); return r; }
  };
  const td = {
    findFirst: async ({ where }) => { const d = [...state.docs.values()].find((x) => x.tenantId === where.tenantId && x.title === where.title); return d ? { id: d.id } : null; },
    create: async ({ data }) => { const id = `d${++state.seq}`; state.docs.set(id, { id, ...data }); return { id }; },
    update: async ({ where, data }) => { const d = state.docs.get(where.id); Object.assign(d, data); return d; }
  };
  return { productCatalog: pc, tenantDocument: td };
}

beforeEach(() => {
  state = { products: [], docs: new Map(), seq: 0 };
  const d = makeDelegates();
  realTx = prisma.$transaction; realPc = prisma.productCatalog; realTd = prisma.tenantDocument;
  prisma.$transaction = async (fn) => fn(d);
  prisma.productCatalog = d.productCatalog;
  prisma.tenantDocument = d.tenantDocument;
});
afterEach(() => { prisma.$transaction = realTx; prisma.productCatalog = realPc; prisma.tenantDocument = realTd; });

describe('catalogIngest: importExtractedProducts (upsert)', () => {
  test('backfills a missing SKU from the name and creates rows', async () => {
    const res = await importExtractedProducts('t1', [{ name: 'Whey Protein', price: '₹1999' }, { name: 'Creatine' }]);
    assert.deepEqual(res, { imported: 2, created: 2, updated: 0, skipped: 0 });
    const rows = await listProducts('t1');
    assert.deepEqual(rows.map((r) => r.sku), ['whey-protein', 'creatine']);
  });

  test('re-importing the same SKU updates in place instead of duplicating', async () => {
    await importExtractedProducts('t1', [{ name: 'Whey Protein', price: '₹1999' }]);
    const res = await importExtractedProducts('t1', [{ name: 'Whey Protein', price: '₹1499', description: 'On sale' }]);
    assert.deepEqual(res, { imported: 1, created: 0, updated: 1, skipped: 0 });
    const rows = await listProducts('t1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, '₹1499');
    assert.equal(rows[0].description, 'On sale');
  });

  test('is additive: it never removes products it did not mention', async () => {
    await addProduct('t1', { name: 'Existing', sku: 'EX-1', price: '$9' });
    await importExtractedProducts('t1', [{ name: 'New Item', price: '$1' }]);
    const skus = (await listProducts('t1')).map((r) => r.sku).sort();
    assert.deepEqual(skus, ['EX-1', 'new-item']);
  });

  test('skips an unusable item (no name) without failing the batch', async () => {
    const res = await importExtractedProducts('t1', [{ price: '$1' }, { name: 'Good', price: '$2' }]);
    assert.deepEqual(res, { imported: 1, created: 1, updated: 0, skipped: 1 });
    assert.deepEqual((await listProducts('t1')).map((r) => r.name), ['Good']);
  });

  test('a tenant only ever touches its own rows', async () => {
    await importExtractedProducts('t1', [{ name: 'Whey', price: '₹1' }]);
    await importExtractedProducts('t2', [{ name: 'Whey', price: '₹2' }]);
    assert.equal((await listProducts('t1'))[0].price, '₹1');
    assert.equal((await listProducts('t2'))[0].price, '₹2');
  });

  test('empty input is a cheap no-op', async () => {
    assert.deepEqual(await importExtractedProducts('t1', []), { imported: 0, created: 0, updated: 0, skipped: 0 });
  });
});
