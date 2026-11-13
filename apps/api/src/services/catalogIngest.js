const prisma = require('../lib/prisma');
const { invalidateTenantKnowledge } = require('../domains/tenantProfile');
const { CATEGORIES } = require('./shared/documentCategory');
const { parseCatalogCsv, catalogToMarkdown } = require('./shared/csvCatalog');
const { matchProducts } = require('./shared/productMatch');
const { slugifySku } = require('./product-extractor/productExtractor');

// How many products to scan per chat turn, and how many cards to attach.
const MATCH_SCAN_LIMIT = 1000;

// Turns a product catalog into both:
//   1. structured ProductCatalog rows (exact, editable product data), and
//   2. one readable TenantDocument (category "Policy/pricing") the existing
//      RAG answers price/product questions from.
// Both the bulk CSV import and the per-item CRUD below keep those two in sync:
// after any change, the document text is rebuilt from the current rows and the
// tenant's cached knowledge is invalidated. Everything is scoped to the
// caller's tenantId — never anything from the request body.

const CATALOG_TITLE = 'Product Catalog';
const MAX = { name: 255, sku: 120, price: 100, description: 2000, category: 120, imageUrl: 1000, productUrl: 1000 };

// Transaction budget for importExtractedProducts. Prisma's interactive-
// transaction defaults are timeout 5s / maxWait 2s, and lib/prisma.js sets no
// override; an auto-import can carry up to 200 products (the extractor's cap)
// and runs behind a crawl that already took up to two minutes, so the default
// is too tight to rely on. Stated explicitly rather than inherited, because the
// failure mode is a swallowed P2028 that looks exactly like "no products here".
const IMPORT_TX_TIMEOUT_MS = 30000;
const IMPORT_TX_MAX_WAIT_MS = 10000;

class ProductError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ProductError';
    this.statusCode = statusCode;
  }
}

function str(value, field, { required = false, max } = {}) {
  const s = String(value ?? '').trim();
  if (!s) {
    if (required) throw new ProductError(`${field} is required`);
    return '';
  }
  if (max && s.length > max) throw new ProductError(`${field} must be ${max} characters or fewer`);
  return s;
}

function validateUrl(value, field, max) {
  const s = str(value, field, { max });
  if (s && !/^https?:\/\/\S+$/i.test(s)) throw new ProductError(`${field} must be an http(s) URL`);
  return s;
}

// Builds a clean product object from client input. In partial mode (updates)
// only the provided fields are included, so untouched columns keep their value.
function validateProduct(data, { partial = false } = {}) {
  const out = {};
  const has = (k) => data && Object.prototype.hasOwnProperty.call(data, k);
  if (!partial || has('name')) out.name = str(data?.name, 'name', { required: true, max: MAX.name });
  if (!partial || has('sku')) out.sku = str(data?.sku, 'sku', { required: true, max: MAX.sku });
  if (!partial || has('price')) out.price = str(data?.price, 'price', { max: MAX.price });
  if (!partial || has('description')) out.description = str(data?.description, 'description', { max: MAX.description });
  if (!partial || has('category')) out.category = str(data?.category, 'category', { max: MAX.category }) || null;
  if (!partial || has('imageUrl')) out.imageUrl = validateUrl(data?.imageUrl, 'imageUrl', MAX.imageUrl) || null;
  if (!partial || has('productUrl')) out.productUrl = validateUrl(data?.productUrl, 'productUrl', MAX.productUrl) || null;
  if (partial && Object.keys(out).length === 0) throw new ProductError('No fields to update');
  return out;
}

// The one catalog document for this tenant, created empty if missing.
async function getOrCreateCatalogDocId(tx, tenantId) {
  const existing = await tx.tenantDocument.findFirst({ where: { tenantId, title: CATALOG_TITLE }, select: { id: true } });
  if (existing) return existing.id;
  const doc = await tx.tenantDocument.create({
    data: { tenantId, title: CATALOG_TITLE, content: catalogToMarkdown([]), category: CATEGORIES.CUSTOM_POLICY }
  });
  return doc.id;
}

// Rebuilds the catalog document's text from the tenant's current rows, so the
// RAG always reflects the latest edits.
async function rebuildDocContent(tx, tenantId, docId) {
  const rows = await tx.productCatalog.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  await tx.tenantDocument.update({ where: { id: docId }, data: { content: catalogToMarkdown(rows) } });
}

/**
 * Replaces the whole catalog (bulk CSV import). Prior catalog document(s) and
 * their rows are removed first — a clean replace, not an append.
 * @returns {Promise<{ productCount: number, documentId: string }>}
 */
async function replaceCatalog(tenantId, products) {
  const documentId = await prisma.$transaction(async (tx) => {
    const prior = await tx.productCatalog.findMany({ where: { tenantId, documentId: { not: null } }, select: { documentId: true }, distinct: ['documentId'] });
    const priorDocIds = prior.map((p) => p.documentId).filter(Boolean);
    if (priorDocIds.length) await tx.tenantDocument.deleteMany({ where: { id: { in: priorDocIds }, tenantId } });
    await tx.productCatalog.deleteMany({ where: { tenantId, documentId: null } });

    const doc = await tx.tenantDocument.create({
      data: { tenantId, title: CATALOG_TITLE, content: catalogToMarkdown(products), category: CATEGORIES.CUSTOM_POLICY }
    });
    await tx.productCatalog.createMany({
      data: products.map((p) => ({
        tenantId, documentId: doc.id, name: p.name, sku: p.sku, price: p.price, description: p.description,
        category: p.category || null, imageUrl: p.imageUrl || null, productUrl: p.productUrl || null
      }))
    });
    return doc.id;
  });
  await invalidateTenantKnowledge(tenantId);
  return { productCount: products.length, documentId };
}

async function ingestCatalogCsv(tenantId, csvText) {
  const { products, skipped } = parseCatalogCsv(csvText);
  const result = await replaceCatalog(tenantId, products);
  return { ...result, skipped };
}

// Upserts auto-extracted products (services/product-extractor/productExtractor.js) into the
// catalog, so re-ingesting the same source updates rows in place instead of
// piling up duplicates. Unlike replaceCatalog (the CSV "clean replace"), this is
// ADDITIVE and non-destructive — it never removes products the extractor didn't
// mention, so a one-page scrape or a single brochure can't wipe the catalog.
//
// Each item is matched to an existing row by (tenantId, sku); the SKU is
// backfilled from the name when absent. Everything runs in one transaction and
// rebuilds the catalog document + invalidates knowledge once at the end (not
// per item). An item that fails validation (e.g. no name) is skipped, never
// fatal — ingestion must not fail because one extracted item was unusable.
// @returns {Promise<{ imported: number, created: number, updated: number, skipped: number }>}
async function importExtractedProducts(tenantId, products) {
  const list = Array.isArray(products) ? products : [];
  if (!list.length) return { imported: 0, created: 0, updated: 0, skipped: 0 };

  // Validate and de-duplicate BEFORE opening the transaction — it is pure work
  // and does not belong inside a database budget. Two extracted items can
  // collapse onto one SKU (the SKU is backfilled from the name here, so
  // "Whey Protein" and "Whey Protein!" both slugify to whey-protein); last one
  // wins, which is what the previous per-item loop did by finding and updating
  // the row it had just created.
  let skipped = 0;
  const bySku = new Map();
  for (const p of list) {
    try {
      const row = validateProduct({ ...p, sku: str(p?.sku, 'sku') || slugifySku(p?.name) });
      bySku.set(row.sku, row);
    } catch {
      skipped += 1; // an unusable item (no name, over-long field) — skip it
    }
  }
  if (!bySku.size) return { imported: 0, created: 0, updated: 0, skipped };

  // One read for every SKU in the batch, then one batched insert — rather than
  // a findFirst plus a create/update per product. The extractor caps an ingest
  // at 200 products, so the old shape cost ~400 sequential round trips inside a
  // single interactive transaction whose default budget is 5s; blowing it threw
  // P2028, which autoPopulateCatalog swallows, so the tenant saw "0 products"
  // with nothing logged as an error. replaceCatalog above has always batched.
  // Updates stay per-row because each carries different values and
  // (tenantId, sku) has only a plain index, so there is no bulk upsert to use.
  let created = 0; let updated = 0;
  await prisma.$transaction(async (tx) => {
    const docId = await getOrCreateCatalogDocId(tx, tenantId);
    const existing = await tx.productCatalog.findMany({
      where: { tenantId, sku: { in: [...bySku.keys()] } },
      select: { id: true, sku: true }
    });
    const idBySku = new Map(existing.map((r) => [r.sku, r.id]));

    const fresh = [];
    for (const [sku, row] of bySku) {
      const id = idBySku.get(sku);
      if (id) { await tx.productCatalog.update({ where: { id }, data: { ...row, documentId: docId } }); updated += 1; }
      else fresh.push({ tenantId, documentId: docId, ...row });
    }
    if (fresh.length) {
      await tx.productCatalog.createMany({ data: fresh });
      created = fresh.length;
    }
    await rebuildDocContent(tx, tenantId, docId);
  }, { timeout: IMPORT_TX_TIMEOUT_MS, maxWait: IMPORT_TX_MAX_WAIT_MS });

  await invalidateTenantKnowledge(tenantId);
  return { imported: created + updated, created, updated, skipped };
}

function getCatalogSummary(tenantId) {
  return prisma.productCatalog.count({ where: { tenantId } }).then((productCount) => ({ hasCatalog: productCount > 0, productCount }));
}

/** All of the tenant's products, oldest first. */
function listProducts(tenantId) {
  return prisma.productCatalog.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
}

/**
 * Products this chat turn is about, as card data, for the reply to attach
 * (services/shared/productMatch.js). One indexed read scoped to the tenant;
 * returns [] (cheaply) for tenants with no catalog. Never throws to the caller
 * via rejection it can't handle — the caller treats failures as "no cards".
 * @param {string} tenantId
 * @param {string} text  usually `${query}\n${answer}`
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
async function matchCatalogProducts(tenantId, text, opts = {}) {
  if (!tenantId || !String(text || '').trim()) return [];
  const products = await prisma.productCatalog.findMany({
    where: { tenantId },
    take: MATCH_SCAN_LIMIT,
    select: { id: true, name: true, sku: true, price: true, description: true, imageUrl: true, productUrl: true }
  });
  return matchProducts(products, text, opts);
}

/** Add one product, keeping the catalog document in sync. */
async function addProduct(tenantId, data) {
  const row = validateProduct(data);
  const created = await prisma.$transaction(async (tx) => {
    const docId = await getOrCreateCatalogDocId(tx, tenantId);
    const r = await tx.productCatalog.create({ data: { tenantId, documentId: docId, ...row } });
    await rebuildDocContent(tx, tenantId, docId);
    return r;
  });
  await invalidateTenantKnowledge(tenantId);
  return created;
}

/** Update one product (tenant-scoped), keeping the catalog document in sync. */
async function updateProduct(tenantId, id, data) {
  const patch = validateProduct(data, { partial: true });
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.productCatalog.findFirst({ where: { id: String(id), tenantId }, select: { id: true, documentId: true } });
    if (!existing) throw new ProductError('Product not found', 404);
    const r = await tx.productCatalog.update({ where: { id: existing.id }, data: patch });
    const docId = existing.documentId || await getOrCreateCatalogDocId(tx, tenantId);
    if (!existing.documentId) await tx.productCatalog.update({ where: { id: existing.id }, data: { documentId: docId } });
    await rebuildDocContent(tx, tenantId, docId);
    return r;
  });
  await invalidateTenantKnowledge(tenantId);
  return updated;
}

/** Delete one product (tenant-scoped), keeping the catalog document in sync. */
async function deleteProduct(tenantId, id) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.productCatalog.findFirst({ where: { id: String(id), tenantId }, select: { id: true, documentId: true } });
    if (!existing) throw new ProductError('Product not found', 404);
    await tx.productCatalog.delete({ where: { id: existing.id } });
    if (existing.documentId) await rebuildDocContent(tx, tenantId, existing.documentId);
  });
  await invalidateTenantKnowledge(tenantId);
  return { deleted: true };
}

module.exports = {
  ingestCatalogCsv, replaceCatalog, importExtractedProducts, getCatalogSummary,
  listProducts, addProduct, updateProduct, deleteProduct, matchCatalogProducts,
  ProductError, CATALOG_TITLE
};
