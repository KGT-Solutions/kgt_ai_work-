// The Automated Intelligent Product Extractor as the dashboard actually reaches
// it: real express, the real workspace router, the real extractor and the real
// catalog import — only Postgres is replaced, by an in-memory stand-in.
//
// autoPopulateCatalog() is wired into four routes (/documents, /documents/file,
// /documents/pdf, /scrape). Its contract, per its own comment, is:
//
//   "Best-effort and never throws: a failure here can only mean 'no cards yet',
//    never a failed upload."
//
// Stubbing at the Prisma layer rather than at the service boundary is
// deliberate: tenantWorkspace.routes.js destructures importExtractedProducts at
// require time, so reassigning the service export after the router has loaded
// would have no effect and the test would silently exercise nothing.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const prisma = require('../../src/lib/prisma');
const { CATALOG_TITLE } = require('../../src/services/catalogIngest');

const TENANT = { id: 't-auto', slug: 'auto-co', name: 'Auto Co' };

let server;
let base;
let state;
let failCreate;
const real = {};

function makeDelegates() {
  const pc = {
    findMany: async ({ where }) => state.products.filter((r) => r.tenantId === where.tenantId),
    count: async ({ where }) => state.products.filter((r) => r.tenantId === where.tenantId).length,
    findFirst: async ({ where }) => state.products.find((r) =>
      (where.id ? r.id === where.id : true) &&
      (where.tenantId ? r.tenantId === where.tenantId : true) &&
      (where.sku ? r.sku === where.sku : true)) || null,
    create: async ({ data }) => {
      if (failCreate) throw new Error('P2028 Transaction already closed');
      const r = { id: `p${++state.seq}`, ...data };
      state.products.push(r);
      return r;
    },
    update: async ({ where, data }) => { const r = state.products.find((x) => x.id === where.id); Object.assign(r, data); return r; }
  };
  const td = {
    count: async () => state.docs.size, // always well under the 500 cap
    findFirst: async ({ where }) => {
      const d = [...state.docs.values()].find((x) => x.tenantId === where.tenantId && x.title === where.title);
      return d ? { id: d.id } : null;
    },
    findMany: async () => [],
    create: async ({ data, select }) => {
      const id = `d${++state.seq}`;
      const row = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
      state.docs.set(id, row);
      if (!select) return row;
      return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
    },
    update: async ({ where, data }) => { const d = state.docs.get(where.id); Object.assign(d, data); return d; }
  };
  return { productCatalog: pc, tenantDocument: td };
}

before(async () => {
  real.tx = prisma.$transaction;
  real.pc = prisma.productCatalog;
  real.td = prisma.tenantDocument;

  const d = makeDelegates();
  prisma.$transaction = async (fn) => (typeof fn === 'function' ? fn(d) : Promise.all(fn));
  prisma.productCatalog = d.productCatalog;
  prisma.tenantDocument = d.tenantDocument;

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // app.js mounts this router behind requireClient, which is what sets
  // req.tenant; stubbed here so the router under test is the real one.
  app.use('/workspace', (req, _res, next) => { req.tenant = TENANT; next(); }, require('../../src/routes/tenantWorkspace.routes'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/workspace`;
});

after(() => {
  prisma.$transaction = real.tx;
  prisma.productCatalog = real.pc;
  prisma.tenantDocument = real.td;
  server.close();
});

beforeEach(() => {
  state = { products: [], docs: new Map(), seq: 0 };
  failCreate = false;
  delete process.env.AUTO_PRODUCT_EXTRACTION;
  delete process.env.SCRAPE_DISTILLATION_PRODUCTS;
});

const postNote = (body) =>
  fetch(`${base}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

const CATALOG_NOTE = [
  '| Product | Price | SKU |',
  '| --- | --- | --- |',
  '| Whey Protein 1kg | Rs. 1,999 | WP-1K |',
  '| Creatine 250g | Rs. 899 | CR-250 |'
].join('\n');

// The one document the import creates for itself, excluded when counting the
// documents the ROUTE saved.
const savedNotes = () => [...state.docs.values()].filter((d) => d.title !== CATALOG_TITLE);

describe('workspace /documents: automatic catalog population', () => {
  test('a pasted product table is saved AND its products imported', async () => {
    const res = await postNote({ title: 'Price list', content: CATALOG_NOTE, category: 'CUSTOM_POLICY' });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(savedNotes().length, 1, 'the document itself is saved');
    assert.equal(body.importedProducts, 2, 'the response reports what reached the catalog');
    assert.deepEqual(state.products.map((p) => p.sku), ['WP-1K', 'CR-250']);
    assert.ok(state.products.every((p) => p.tenantId === TENANT.id), 'written against the session tenant only');
  });

  test('every imported product is verbatim from the submitted text', async () => {
    await postNote({ title: 'Price list', content: CATALOG_NOTE });
    for (const p of state.products) {
      assert.ok(CATALOG_NOTE.includes(p.name), `${p.name} should appear in the submitted note`);
      if (p.price) assert.ok(CATALOG_NOTE.includes(p.price), `price ${p.price} should be verbatim`);
    }
  });

  test('re-pasting the same table updates in place instead of duplicating', async () => {
    await postNote({ title: 'Price list', content: CATALOG_NOTE });
    const res = await postNote({ title: 'Price list v2', content: CATALOG_NOTE.replace('1,999', '1,499') });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.importedProducts, 2);
    assert.equal(state.products.length, 2, 'still two products, not four');
    assert.equal(state.products.find((p) => p.sku === 'WP-1K').price, 'Rs. 1,499');
  });

  test('AUTO_PRODUCT_EXTRACTION=false turns it off without affecting the upload', async () => {
    process.env.AUTO_PRODUCT_EXTRACTION = 'false';
    const res = await postNote({ title: 'Price list', content: CATALOG_NOTE });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(savedNotes().length, 1, 'the document is still saved');
    assert.equal(body.importedProducts, 0);
    assert.equal(state.products.length, 0, 'no catalog write at all');
  });

  test('a note with no products imports nothing and still saves', async () => {
    const res = await postNote({ title: 'Returns', content: 'Unopened items can be returned within 30 days.' });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(savedNotes().length, 1);
    assert.equal(body.importedProducts, 0);
    assert.equal(state.products.length, 0);
  });

  test('a failing catalog write cannot fail the upload (best-effort contract)', async () => {
    failCreate = true;
    const res = await postNote({ title: 'Price list', content: CATALOG_NOTE });
    const body = await res.json();

    assert.equal(res.status, 201, 'the document was already committed — the response must still be 201');
    assert.equal(savedNotes().length, 1);
    assert.equal(body.importedProducts, 0, 'reported as "no cards yet", not as an error');
  });

  test('the saved document is unchanged by extraction — content stays verbatim', async () => {
    await postNote({ title: 'Price list', content: CATALOG_NOTE, category: 'CUSTOM_POLICY' });
    const note = savedNotes()[0];
    assert.equal(note.content, CATALOG_NOTE);
    assert.equal(note.tenantId, TENANT.id);
  });

  test('an invalid note is rejected before any catalog work happens', async () => {
    const res = await postNote({ title: '', content: '' });
    assert.equal(res.status, 400);
    assert.equal(state.products.length, 0);
    assert.equal(state.docs.size, 0);
  });
});

describe('workspace /documents: what auto-population must NOT invent', () => {
  test('a policy note that quotes amounts does not become a product catalog', async () => {
    // The counterpart to productExtractorPrecision.test.js, at the route level:
    // this is the request a support-only tenant makes constantly, and every row
    // it creates becomes a purchasable card under a chat reply.
    //
    // FAILING AGAINST productExtractor.js AS WRITTEN: the heading pass accepts a
    // bare price as sufficient signal, so "Refund Threshold" and "Restocking
    // Fee" are imported as products. See productExtractorPrecision.test.js for
    // the fix.
    const policy = [
      '## Refund Threshold',
      '',
      'Orders above $50 qualify for free return shipping.',
      '',
      '## Restocking Fee',
      '',
      'A restocking fee of $15 applies to opened items.'
    ].join('\n');

    const res = await postNote({ title: 'Returns policy', content: policy, category: 'CUSTOM_POLICY' });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(savedNotes().length, 1, 'the policy is still saved as a document');
    assert.equal(body.importedProducts, 0, 'a policy document creates no product cards');
    assert.deepEqual(state.products, []);
  });
});
