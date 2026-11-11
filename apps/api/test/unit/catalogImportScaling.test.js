// How importExtractedProducts behaves at the sizes the extractor can actually
// hand it.
//
// productExtractor caps one ingest at MAX_PRODUCTS = 200, and a 150-page
// e-commerce crawl will reach that cap routinely. These tests pin the database
// shape of the import at that size, because the failure mode is silent: the
// caller (routes/tenantWorkspace.routes.js autoPopulateCatalog) swallows any
// throw into `return 0`, so a transaction that aborts looks exactly like "this
// page had no products".
//
// The sibling file catalogImport.test.js covers the semantics (upsert by SKU,
// additive, tenant isolation, skip-not-fail). This file covers cost.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../../src/lib/prisma');
const { importExtractedProducts, replaceCatalog } = require('../../src/services/catalogIngest');

let state;
let calls;
let txOptions;
const real = {};

function makeDelegates() {
  const count = (name) => { calls[name] = (calls[name] || 0) + 1; };
  const pc = {
    findMany: async ({ where }) => { count('productCatalog.findMany'); return state.products.filter((r) => r.tenantId === where.tenantId); },
    findFirst: async ({ where }) => {
      count('productCatalog.findFirst');
      return state.products.find((r) =>
        (where.id ? r.id === where.id : true) &&
        (where.tenantId ? r.tenantId === where.tenantId : true) &&
        (where.sku ? r.sku === where.sku : true)) || null;
    },
    create: async ({ data }) => { count('productCatalog.create'); const r = { id: `p${++state.seq}`, ...data }; state.products.push(r); return r; },
    createMany: async ({ data }) => {
      count('productCatalog.createMany');
      for (const d of data) state.products.push({ id: `p${++state.seq}`, ...d });
      return { count: data.length };
    },
    update: async ({ where, data }) => { count('productCatalog.update'); const r = state.products.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    deleteMany: async () => { count('productCatalog.deleteMany'); return { count: 0 }; }
  };
  const td = {
    findFirst: async ({ where }) => { count('tenantDocument.findFirst'); const d = [...state.docs.values()].find((x) => x.tenantId === where.tenantId && x.title === where.title); return d ? { id: d.id } : null; },
    findMany: async () => { count('tenantDocument.findMany'); return []; },
    create: async ({ data }) => { count('tenantDocument.create'); const id = `d${++state.seq}`; state.docs.set(id, { id, ...data }); return { id }; },
    update: async ({ where, data }) => { count('tenantDocument.update'); const d = state.docs.get(where.id); Object.assign(d, data); return d; },
    deleteMany: async () => { count('tenantDocument.deleteMany'); return { count: 0 }; }
  };
  return { productCatalog: pc, tenantDocument: td };
}

const totalQueries = () => Object.values(calls).reduce((a, b) => a + b, 0);

beforeEach(() => {
  state = { products: [], docs: new Map(), seq: 0 };
  calls = {};
  txOptions = undefined;
  const d = makeDelegates();
  real.tx = prisma.$transaction; real.pc = prisma.productCatalog; real.td = prisma.tenantDocument;
  // Capture the options argument so a test can assert the transaction budget.
  prisma.$transaction = async (fn, options) => { txOptions = options; return fn(d); };
  prisma.productCatalog = d.productCatalog;
  prisma.tenantDocument = d.tenantDocument;
});
afterEach(() => { prisma.$transaction = real.tx; prisma.productCatalog = real.pc; prisma.tenantDocument = real.td; });

const manyProducts = (n) =>
  Array.from({ length: n }, (_, i) => ({ name: `Product ${i + 1}`, sku: `SKU-${i + 1}`, price: `₹${i + 1}99` }));

describe('catalogIngest: importExtractedProducts at extractor scale', () => {
  test('a full 200-product import still imports all 200', async () => {
    const res = await importExtractedProducts('t1', manyProducts(200));
    assert.equal(res.imported, 200);
    assert.equal(res.created, 200);
  });

  test('it does not issue a query per product per operation', async () => {
    await importExtractedProducts('t1', manyProducts(200));

    // Each product currently costs a findFirst plus a create/update, run
    // sequentially inside ONE interactive transaction — ~400 round trips. The
    // CSV path right beside it (replaceCatalog) does the same work in a single
    // createMany, which is the pattern this should follow.
    //
    // FAILING AGAINST catalogIngest.js AS WRITTEN: 200 findFirst + 200 create.
    // Fix: read the tenant's existing SKUs once (one findMany), then batch the
    // inserts with createMany and issue updates only for the rows that changed.
    assert.ok(
      totalQueries() < 100,
      `a 200-product import should not cost ~2 queries per product; it issued ${totalQueries()} ` +
      `(${JSON.stringify(calls)})`
    );
  });

  test('the CSV path it mirrors batches its inserts (the pattern to follow)', async () => {
    // Reference point, and a guard that replaceCatalog does not regress into a
    // per-row loop either.
    await replaceCatalog('t1', manyProducts(200).map((p) => ({ ...p, description: '', category: null, imageUrl: null, productUrl: null })));
    assert.equal(calls['productCatalog.createMany'], 1);
    assert.equal(calls['productCatalog.create'], undefined);
  });

  test('a long import is given an explicit transaction budget, not the 5s default', async () => {
    await importExtractedProducts('t1', manyProducts(200));

    // Prisma's interactive-transaction default is timeout: 5000ms / maxWait:
    // 2000ms, and lib/prisma.js is a bare `new PrismaClient()` with no
    // override. A few hundred sequential round trips against a real Postgres
    // can exceed that, and P2028 here is swallowed by autoPopulateCatalog —
    // the tenant sees "0 products" with nothing logged as an error.
    //
    // FAILING AGAINST catalogIngest.js AS WRITTEN: $transaction is called with
    // no options. Fix: pass an explicit { timeout } sized for the batch (and
    // ideally shrink the work per the test above so the budget is ample).
    assert.ok(
      txOptions && Number(txOptions.timeout) > 5000,
      'importExtractedProducts should pass an explicit transaction timeout above the 5s default, ' +
      `got ${JSON.stringify(txOptions)}`
    );
  });
});
