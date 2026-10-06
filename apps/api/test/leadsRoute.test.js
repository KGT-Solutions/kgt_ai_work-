const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// GET /leads and PATCH /leads/:id on the workspace router (the one mounted
// at /api/v1/client/workspace). Prisma's lead model is an in-memory table
// that applies the same where/orderBy/take the route asks the database for,
// so these check that filtering happens in the query, scoped to the tenant.

const prisma = require('../src/lib/prisma');
const workspaceRouter = require('../src/routes/tenantWorkspace.routes');

const TENANT_ID = 'tenant-r';
let rows, queries;
const lead = (id, tenantId, botType, status, minutesAgo) =>
  ({ id, tenantId, botType, status, email: `${id}@x.com`, createdAt: new Date(Date.now() - minutesAgo * 60_000) });
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

let server, base;
before(async () => {
  prisma.lead.findMany = async ({ where, orderBy, take }) => {
    queries.push(where);
    const dir = orderBy.createdAt === 'desc' ? -1 : 1;
    return rows.filter((r) => matches(r, where)).sort((a, b) => dir * (a.createdAt - b.createdAt)).slice(0, take);
  };
  prisma.lead.groupBy = async ({ by, where }) => {
    const groups = new Map();
    for (const r of rows.filter((r) => matches(r, where))) {
      const key = by.map((k) => r[k]).join('|');
      const g = groups.get(key) || { ...Object.fromEntries(by.map((k) => [k, r[k]])), _count: { _all: 0 } };
      g._count._all += 1;
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  prisma.lead.findFirst = async ({ where }) => rows.find((r) => matches(r, where)) || null;
  prisma.lead.update = async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.tenant = { id: TENANT_ID }; req.actor = 'client'; next(); });
  app.use('/', workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => {
  queries = [];
  rows = [
    lead('s-new', TENANT_ID, 'sales', 'NEW', 1),
    lead('s-done', TENANT_ID, 'sales', 'CONTACTED', 2),
    lead('p-new', TENANT_ID, 'support', 'NEW', 3),
    lead('p-new2', TENANT_ID, 'support', 'NEW', 4),
    lead('other', 'someone-else', 'sales', 'NEW', 0)
  ];
});

const get = async (qs = '') => {
  const res = await fetch(`${base}/leads${qs}`);
  return { status: res.status, body: await res.json() };
};
const ids = (body) => body.leads.map((l) => l.id);

describe('GET /leads', () => {
  test('no filter: every lead of this tenant, newest first, and never another tenant\'s', async () => {
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.deepEqual(ids(body), ['s-new', 's-done', 'p-new', 'p-new2']);
    assert.deepEqual(queries[0], { tenantId: TENANT_ID });
    assert.deepEqual(body.filters, { botType: 'all', status: 'all' });
  });

  test('bot and status filters go into the database query, alone and combined', async () => {
    assert.deepEqual(ids((await get('?botType=sales')).body), ['s-new', 's-done']);
    assert.deepEqual(ids((await get('?botType=support')).body), ['p-new', 'p-new2']);
    assert.deepEqual(ids((await get('?status=NEW')).body), ['s-new', 'p-new', 'p-new2']);
    assert.deepEqual(ids((await get('?status=contacted')).body), ['s-done'], 'status is case-insensitive');
    assert.deepEqual(ids((await get('?botType=Support&status=NEW')).body), ['p-new', 'p-new2']);
    assert.deepEqual(ids((await get('?botType=support&status=CONTACTED')).body), []);
    assert.deepEqual(queries.at(-1), { tenantId: TENANT_ID, botType: 'support', status: 'CONTACTED' });
    assert.deepEqual(ids((await get('?botType=all&status=all')).body).length, 4);
  });

  test('counts cover all of the tenant\'s leads, whatever the filter', async () => {
    const { body } = await get('?botType=sales&status=CONTACTED');
    assert.deepEqual(body.counts, { total: 4, sales: 2, support: 2, NEW: 3, CONTACTED: 1 });
  });

  test('unknown filter values are rejected, not ignored', async () => {
    assert.equal((await get('?botType=marketing')).status, 400);
    assert.equal((await get('?status=ARCHIVED')).status, 400);
    assert.equal(queries.length, 0);
  });
});

describe('PATCH /leads/:id', () => {
  const patch = (id, body) => fetch(`${base}/leads/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });

  test('marking a lead contacted moves it between the status filters', async () => {
    assert.equal((await patch('p-new', { status: 'CONTACTED' })).status, 200);
    assert.deepEqual(ids((await get('?status=CONTACTED')).body), ['s-done', 'p-new']);
    assert.deepEqual(ids((await get('?status=NEW')).body), ['s-new', 'p-new2']);
  });

  test('another tenant\'s lead reads as missing; a bad status is rejected', async () => {
    assert.equal((await patch('other', { status: 'CONTACTED' })).status, 404);
    assert.equal(rows.find((r) => r.id === 'other').status, 'NEW');
    assert.equal((await patch('s-new', { status: 'WON' })).status, 400);
  });
});
