const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Phase A — a document mutation schedules a background readiness re-audit, but a
// mutation that adds NOTHING (e.g. a zip whose files were all skipped) must not
// burn an LLM audit. These mocks must be installed BEFORE the router is required,
// because it destructures them at load.
const fileIngest = require('../../src/services/shared/fileIngest');
let pagesToReturn = [];
mock.method(fileIngest, 'ingestUpload', async () => ({ pages: pagesToReturn, files: [] }));

const tenantFaqs = require('../../src/services/tenantFaqs');
mock.method(tenantFaqs, 'scheduleFaqGeneration', () => {});

const tenantProfile = require('../../src/domains/tenantProfile');
mock.method(tenantProfile, 'invalidateTenantKnowledge', async () => {});

const botAuditor = require('../../src/services/botAuditor');
const auditMock = mock.method(botAuditor, 'scheduleTenantAudit', () => {});

process.env.AUTO_PRODUCT_EXTRACTION = '0'; // skip the catalog auto-extract side effect

const prisma = require('../../src/lib/prisma');
const workspaceRouter = require('../../src/routes/tenantWorkspace.routes');

const TENANT_ID = 'tenant-d';
let created;

let server, base;
before(async () => {
  prisma.tenantDocument.count = async () => 0; // always room
  prisma.tenantDocument.createMany = async ({ data }) => { created = data; return { count: data.length }; };

  const app = express();
  app.use((req, _res, next) => { req.tenant = { id: TENANT_ID }; req.actor = 'client'; next(); });
  app.use('/', workspaceRouter);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

beforeEach(() => { created = null; auditMock.mock.resetCalls(); });

const uploadFile = () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('dummy')], { type: 'text/plain' }), 'notes.txt');
  return fetch(`${base}/documents/file`, { method: 'POST', body: fd });
};

describe('POST /documents/file — audit scheduling', () => {
  test('schedules a re-audit when documents are actually added', async () => {
    pagesToReturn = [{ title: 'Shipping', markdown: 'We ship worldwide.' }];
    const res = await uploadFile();
    assert.equal(res.status, 201);
    assert.equal((await res.json()).documentsCreated, 1);
    assert.equal(created.length, 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[0], TENANT_ID);
  });

  test('does NOT schedule a re-audit when nothing was added (all files skipped)', async () => {
    pagesToReturn = []; // e.g. a zip whose entries were all unreadable
    const res = await uploadFile();
    assert.equal(res.status, 201);
    assert.equal((await res.json()).documentsCreated, 0);
    assert.equal(auditMock.mock.callCount(), 0, 'no empty-upload audit — no wasted LLM call');
  });
});
